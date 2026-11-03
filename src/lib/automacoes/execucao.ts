import type { SupabaseClient } from '@supabase/supabase-js'
import { resumoErro } from '@/lib/log-seguro'

export type MotivoPulo =
  | 'sem_lead'
  | 'ja_na_etapa'
  | 'etapa_nao_movivel'
  | 'sem_telefone'
  | 'sem_conversa'
  | 'modelo_ausente'
  | 'sem_credenciais'
  | 'mal_configurada'

/**
 * Resultado de uma execução de automação, gravado em `automation_runs`.
 * Os pulos de rotina que acontecem a cada mensagem (janela de 24h do modelo,
 * automação por tempo já disparada) não têm variante de propósito: não são gravados.
 */
export type ResultadoAutomacao =
  | { kind: 'etapa_movida'; de: string | null; para: string }
  | { kind: 'modelo_enviado'; templateId: string; waMessageId: string | null }
  | { kind: 'pulado'; motivo: MotivoPulo }
  | { kind: 'falhou'; etapa: 'meta' | 'banco'; erro: string; httpStatus?: number }

export interface ContextoExecucao {
  unitId:         string
  origem:         'evento' | 'tempo'
  automationId:   string
  gatilho:        string
  acao:           string
  leadId:         string | null
  conversationId: string | null
}

const TAMANHO_MAXIMO_ERRO = 500

/**
 * Monta um `falhou` a partir de um erro do Supabase, da Meta ou de uma exceção,
 * guardando só o resumo (código e mensagem), sem dados de pessoas.
 */
export function falha(etapa: 'meta' | 'banco', err: unknown, httpStatus?: number): ResultadoAutomacao {
  const erro = resumoErro(err).slice(0, TAMANHO_MAXIMO_ERRO)
  return httpStatus === undefined ? { kind: 'falhou', etapa, erro } : { kind: 'falhou', etapa, erro, httpStatus }
}

function colunas(resultado: ResultadoAutomacao): { motivo: string | null; detalhe: Record<string, unknown> | null } {
  switch (resultado.kind) {
    case 'etapa_movida':
      return { motivo: null, detalhe: { de: resultado.de, para: resultado.para } }
    case 'modelo_enviado':
      return { motivo: null, detalhe: { templateId: resultado.templateId, waMessageId: resultado.waMessageId } }
    case 'pulado':
      return { motivo: resultado.motivo, detalhe: null }
    case 'falhou':
      return {
        motivo:  resultado.erro,
        detalhe: resultado.httpStatus === undefined
          ? { etapa: resultado.etapa }
          : { etapa: resultado.etapa, httpStatus: resultado.httpStatus },
      }
    default: {
      const nunca: never = resultado
      return nunca
    }
  }
}

/**
 * Grava uma execução em `automation_runs`. Nunca lança: a automação já rodou (ou
 * falhou) e um erro de gravação do rastro não pode derrubar quem chamou.
 *
 * @param supabase - Cliente service-role (o RLS não deixa o navegador gravar)
 */
export async function registrarExecucao(
  supabase:  SupabaseClient,
  contexto:  ContextoExecucao,
  resultado: ResultadoAutomacao,
): Promise<void> {
  try {
    const { motivo, detalhe } = colunas(resultado)
    const { error } = await supabase.from('automation_runs').insert({
      unit_id:         contexto.unitId,
      origem:          contexto.origem,
      automation_id:   contexto.automationId,
      gatilho:         contexto.gatilho,
      acao:            contexto.acao,
      lead_id:         contexto.leadId,
      conversation_id: contexto.conversationId,
      resultado:       resultado.kind,
      motivo,
      detalhe,
    })
    if (error) {
      console.error(`[automacoes] registrarExecucao falhou automation=${contexto.automationId}:`, resumoErro(error))
    }
  } catch (e) {
    console.error(`[automacoes] registrarExecucao lançou automation=${contexto.automationId}:`, resumoErro(e))
  }
}

/**
 * Quantas execuções `falhou`/`pulado` a automação teve para o alvo nas últimas 24h.
 * Sem lead nem conversa, conta as execuções da automação sem alvo. Erro na
 * consulta conta como zero (a automação segue rodando).
 */
export async function tentativasSemSucessoRecentes(
  supabase:       SupabaseClient,
  automationId:   string,
  alvo:           { leadId: string | null; conversationId: string | null },
  resultados:     ReadonlyArray<'falhou' | 'pulado'> = ['falhou', 'pulado'],
): Promise<number> {
  let query = supabase
    .from('automation_runs')
    .select('id', { count: 'exact', head: true })
    .eq('automation_id', automationId)
    .in('resultado', [...resultados])
    .gte('criado_em', new Date(Date.now() - 24 * 3600_000).toISOString())

  if (alvo.conversationId) query = query.eq('conversation_id', alvo.conversationId)
  else if (alvo.leadId)    query = query.eq('lead_id', alvo.leadId)
  else                     query = query.is('lead_id', null).is('conversation_id', null)

  const { count, error } = await query
  if (error) {
    console.error(`[automacoes] contagem de tentativas falhou automation=${automationId}:`, resumoErro(error))
    return 0
  }
  return count ?? 0
}
