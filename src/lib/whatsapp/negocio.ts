import type { SupabaseClient } from '@supabase/supabase-js'
import { acaoDaMensagem, type NegocioResumo } from '@/lib/negocios'
import { reaberturaPorMensagem } from '@/lib/status-lead'
import { resumoErro } from '@/lib/log-seguro'

/** 1ª etapa do 1º funil de negócio ativo da unidade, ou null se a unidade não tem funil. */
export async function etapaPadrao(
  supabase: SupabaseClient,
  unitId: string,
): Promise<{ funnel_id: string; stage_id: string } | null> {
  const { data: funil } = await supabase
    .from('funnels').select('id')
    .eq('objeto', 'negocio').eq('unit_id', unitId).eq('ativo', true)
    .order('ordem', { ascending: true }).limit(1).maybeSingle()
  if (!funil?.id) return null
  const { data: etapa } = await supabase
    .from('funnel_stages').select('id')
    .eq('funnel_id', funil.id).order('ordem', { ascending: true }).limit(1).maybeSingle()
  return etapa?.id ? { funnel_id: funil.id as string, stage_id: etapa.id as string } : null
}

/** Contato titular da unidade com este telefone (forma canônica), ou null. */
export async function contatoPorTelefone(
  supabase: SupabaseClient,
  unitId: string,
  norm: string,
): Promise<{ id: string; nome: string } | null> {
  const { data } = await supabase
    .from('contatos').select('id, nome')
    .eq('unit_id', unitId).is('responsavel_id', null).eq('telefone_norm', norm)
    .maybeSingle()
  return data
}

/**
 * O negócio do contato que recebe a mensagem (regra em acaoDaMensagem): o aberto;
 * o aberto arquivado, desarquivado na etapa padrão; ou um negócio novo na etapa
 * padrão quando todos estão ganhos ou perdidos.
 *
 * @param supabase - Cliente service-role
 * @param origem - origem do negócio novo ('whatsapp', 'campanha_whatsapp'...)
 * @returns id do negócio, ou null se não foi possível criar (unidade sem funil)
 */
export async function negocioDaMensagem(
  supabase: SupabaseClient,
  unitId: string,
  contato: { id: string; nome: string },
  origem: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('leads').select('id, status, arquivado, stage_id, created_at')
    .eq('contato_id', contato.id)
  const acao = acaoDaMensagem((data ?? []) as NegocioResumo[])

  if (acao.tipo === 'usar') return acao.negocio.id

  const destino = await etapaPadrao(supabase, unitId)
  if (acao.tipo === 'desarquivar') {
    const reabertura = reaberturaPorMensagem(acao.negocio, destino)
    if (!reabertura) return acao.negocio.id
    const { error } = await supabase.from('leads').update(reabertura.valores).eq('id', acao.negocio.id)
    if (error) {
      console.error(`[negocio] erro ao desarquivar ${acao.negocio.id}:`, resumoErro(error))
      return acao.negocio.id
    }
    if (reabertura.historico) {
      const { error: histErr } = await supabase.from('lead_stage_history').insert({
        lead_id: acao.negocio.id, de_stage_id: reabertura.historico.de, para_stage_id: reabertura.historico.para,
        movido_por: null, movido_via: 'reabertura',
      })
      if (histErr) console.error(`[negocio] histórico ${acao.negocio.id}:`, resumoErro(histErr))
    }
    console.log(`[negocio] desarquivado por mensagem: ${acao.negocio.id}`)
    return acao.negocio.id
  }

  if (!destino) {
    console.error('[negocio] unidade sem funil de negócio: não abre negócio novo')
    return null
  }
  // O banco (150) preenche a pessoa do negócio a partir do contato
  const { data: novo, error } = await supabase.from('leads').insert({
    unit_id: unitId, contato_id: contato.id, nome: contato.nome, origem,
    funnel_id: destino.funnel_id, stage_id: destino.stage_id,
  }).select('id').single()
  if (error || !novo) {
    console.error('[negocio] erro ao abrir negócio novo:', resumoErro(error))
    return null
  }
  console.log(`[negocio] negócio novo ${novo.id} para o contato ${contato.id}`)
  return novo.id as string
}
