import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { canAccessUnit, isPerfilGestor } from '@/lib/auth/access'
import { camposDoFunil } from '@/lib/campos'
import { lerCsv } from '@/lib/csv'
import {
  MAX_LINHAS_IMPORTACAO, classificarErroDeLinha, lerPedidoImportacao, prepararImportacao, separarExistentes,
  validarMapeamento, type LinhaPronta, type PedidoImportacao, type RelatorioImportacao,
} from '@/lib/importacao'
import { telefonesExistentes } from '@/lib/importacao-banco'
import { resumoErro } from '@/lib/log-seguro'
import type { CampoLead, TipoTag } from '@/types/database'

// POST /api/leads/importar — cria leads a partir de um CSV (só gestor/admin).
// Tudo é validado de novo aqui com as mesmas regras da pré-visualização.
// Grava com o client do usuário: o RLS de leads e lead_tags e os triggers de
// status (126), de campos (129) e de campos obrigatórios da etapa (130)
// continuam valendo; as exigências da etapa são conferidas antes, por linha.

export const maxDuration = 120

const LOTE_LEADS = 500
const LOTE_TAGS  = 1000
const LOTE_IDS   = 200

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('perfil, unit_id').eq('id', user.id).single()
  const unitId = profile?.unit_id as string | null | undefined
  if (!profile || !isPerfilGestor(profile.perfil) || !unitId || !(await canAccessUnit(supabase, user.id, unitId))) {
    return NextResponse.json({ error: 'Só gestor ou admin importa contatos' }, { status: 403 })
  }

  const lido = lerPedidoImportacao(await req.json().catch(() => null))
  if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 })
  const pedido = lido.pedido

  const destino = await conferirDestino(supabase, unitId, pedido)
  if ('erro' in destino) return NextResponse.json({ error: destino.erro }, { status: destino.status })

  const csv = lerCsv(pedido.texto)
  if (csv.aspasAbertas) {
    return NextResponse.json({ error: 'O arquivo tem aspas sem fechamento; confira a planilha' }, { status: 400 })
  }
  if (csv.registros.length - 1 > MAX_LINHAS_IMPORTACAO) {
    return NextResponse.json({ error: `Mais de ${MAX_LINHAS_IMPORTACAO} linhas` }, { status: 400 })
  }
  if (pedido.mapeamento.length !== (csv.registros[0]?.length ?? 0)) {
    return NextResponse.json({ error: 'O mapeamento não corresponde às colunas do arquivo' }, { status: 400 })
  }
  const erroMapa = validarMapeamento(pedido.mapeamento, destino.campos)
  if (erroMapa) return NextResponse.json({ error: erroMapa }, { status: 400 })

  const prep = prepararImportacao(csv.registros, pedido.mapeamento, {
    campos: destino.campos, tags: destino.tags, origemPadrao: pedido.origem_padrao,
    funnelId: pedido.funnel_id, exigidos: destino.exigidos, responsavelId: pedido.responsavel_id,
  })
  const busca = await telefonesExistentes(supabase, unitId, prep.linhas.map(l => l.telefoneNorm))
  if (busca.erro) {
    console.error('[leads-importar] erro ao ler telefones existentes:', busca.erro)
    return NextResponse.json({ error: 'Não foi possível conferir os contatos existentes' }, { status: 500 })
  }
  const { novas, existentes } = separarExistentes(prep.linhas, busca.existentes)

  const relatorio: RelatorioImportacao = {
    importados: 0,
    existentes,
    repetidas: prep.repetidas,
    invalidas: [...prep.invalidas],
    tagsDesconhecidas: prep.tagsDesconhecidas,
    avisos: [],
  }

  const base = {
    unit_id:        unitId,
    funnel_id:      pedido.funnel_id,
    stage_id:       pedido.stage_id,
    responsavel_id: pedido.responsavel_id,
    is_converted:   pedido.clientes,
    status:         pedido.clientes ? 'ganho' : 'aberto',
  }
  const gravados: { id: string; linha: LinhaPronta }[] = []

  for (let i = 0; i < novas.length; i += LOTE_LEADS) {
    const lote = novas.slice(i, i + LOTE_LEADS)
    const r = await inserirLote(supabase, lote, base)
    gravados.push(...r.gravados)
    relatorio.existentes.push(...r.existentes)
    relatorio.invalidas.push(...r.invalidas)
    if (r.falhaGeral) {
      relatorio.importados = gravados.length
      console.error(`[leads-importar] interrompida usuario=${user.id} unidade=${unitId} gravados=${gravados.length}:`, r.falhaGeral)
      return NextResponse.json({
        ...relatorio,
        error: `A importação parou por um erro do banco depois de ${gravados.length} contato(s). Reenvie o arquivo: os já importados serão pulados.`,
      }, { status: 500 })
    }
  }
  relatorio.importados = gravados.length

  const erroTags = await aplicarTags(supabase, gravados)
  if (erroTags) relatorio.avisos.push(erroTags)

  if (pedido.clientes) {
    const erroData = await limparDataDeGanho(supabase, gravados.map(g => g.id))
    if (erroData) relatorio.avisos.push(erroData)
  }

  relatorio.existentes.sort((a, b) => a.linha - b.linha)
  relatorio.invalidas.sort((a, b) => a.linha - b.linha)

  console.info(
    `[leads-importar] usuario=${user.id} unidade=${unitId} importados=${relatorio.importados}`
    + ` existentes=${relatorio.existentes.length} repetidas=${relatorio.repetidas.length}`
    + ` invalidas=${relatorio.invalidas.length} clientes=${pedido.clientes}`,
  )
  return NextResponse.json(relatorio)
}

type Destino =
  | { campos: CampoLead[]; tags: { id: string; name: string; tipo: TipoTag }[]; exigidos: string[] }
  | { erro: string; status: number }

async function conferirDestino(supabase: SupabaseClient, unitId: string, pedido: PedidoImportacao): Promise<Destino> {
  const [{ data: funil }, { data: etapa }, { data: campos, error: camposErr }, { data: tags, error: tagsErr }] = await Promise.all([
    supabase.from('funnels').select('id').eq('id', pedido.funnel_id).eq('unit_id', unitId).eq('ativo', true).maybeSingle(),
    supabase.from('funnel_stages').select('id, resultado, campos_obrigatorios').eq('id', pedido.stage_id).eq('funnel_id', pedido.funnel_id).maybeSingle(),
    supabase.from('campos_lead').select('*').eq('unit_id', unitId),
    supabase.from('wa_tags').select('id, name, tipo').eq('unit_id', unitId).eq('tipo', 'lead'),
  ])
  if (!funil) return { erro: 'Funil não encontrado nesta unidade', status: 400 }
  if (!etapa) return { erro: 'Etapa não encontrada neste funil', status: 400 }
  // Etapa com resultado mudaria o status pelo trigger da 126 (perdido com motivo inventado, ganho com data de hoje)
  if (etapa.resultado) return { erro: 'Escolha uma etapa sem resultado (não Ganho nem Perdido)', status: 400 }
  if (camposErr || tagsErr) return { erro: 'Não foi possível ler campos e tags da unidade', status: 500 }

  if (pedido.responsavel_id) {
    const [{ data: perfil }, { data: vinculo }] = await Promise.all([
      supabase.from('profiles').select('id').eq('id', pedido.responsavel_id).eq('unit_id', unitId).maybeSingle(),
      supabase.from('user_units').select('user_id').eq('user_id', pedido.responsavel_id).eq('unit_id', unitId)
        .eq('ativo', true).maybeSingle(),
    ])
    if (!perfil && !vinculo) return { erro: 'Responsável não é desta unidade', status: 400 }
  }

  return {
    campos:   camposDoFunil((campos ?? []) as CampoLead[], pedido.funnel_id),
    tags:     (tags ?? []) as { id: string; name: string; tipo: TipoTag }[],
    exigidos: (etapa.campos_obrigatorios ?? []) as string[],
  }
}

interface ResultadoLote {
  gravados:   { id: string; linha: LinhaPronta }[]
  existentes: { linha: number; telefone: string }[]
  invalidas:  { linha: number; motivo: string }[]
  falhaGeral: string | null
}

/**
 * Insere o lote de uma vez; se o banco recusar (telefone criado no meio do
 * caminho, valor recusado por trigger), refaz linha a linha para pular só as
 * que falham. Telefone repetido vira "já existe" pelo índice único
 * uq_leads_unit_telefone_norm: por isso reenviar o mesmo arquivo não duplica.
 * (O índice é parcial, WHERE telefone_norm IS NOT NULL; ON CONFLICT pelo
 * PostgREST não consegue inferir índice parcial, daí o 23505 por linha.)
 * Campo exigido pela etapa (VC001, 130) já foi barrado em prepararImportacao;
 * se ainda vier (etapa mudada no meio da importação), a linha é inválida.
 */
async function inserirLote(
  supabase: SupabaseClient,
  lote: LinhaPronta[],
  base: Record<string, unknown>,
): Promise<ResultadoLote> {
  const resultado: ResultadoLote = { gravados: [], existentes: [], invalidas: [], falhaGeral: null }
  const linha = (l: LinhaPronta) => ({ ...base, ...l.dados, campos: l.campos })

  const { data, error } = await supabase.from('leads').insert(lote.map(linha)).select('id, telefone_norm')
  if (!error) {
    const porTelefone = new Map(lote.map(l => [l.telefoneNorm, l]))
    for (const r of data ?? []) {
      const l = porTelefone.get(r.telefone_norm as string)
      if (l) resultado.gravados.push({ id: r.id as string, linha: l })
    }
    return resultado
  }

  for (const l of lote) {
    const { data: lead, error: err } = await supabase.from('leads').insert(linha(l)).select('id').single()
    if (!err && lead) {
      resultado.gravados.push({ id: lead.id as string, linha: l })
      continue
    }
    switch (classificarErroDeLinha(err)) {
      case 'existe':
        resultado.existentes.push({ linha: l.linha, telefone: l.dados.telefone })
        break
      case 'invalida':
        resultado.invalidas.push({ linha: l.linha, motivo: err?.message ?? 'Recusado pelo banco' })
        break
      case 'fatal':
        resultado.falhaGeral = resumoErro(err)
        return resultado
    }
  }
  return resultado
}

async function aplicarTags(supabase: SupabaseClient, gravados: { id: string; linha: LinhaPronta }[]): Promise<string | null> {
  const pares = gravados.flatMap(g => g.linha.tagIds.map(tag_id => ({ lead_id: g.id, tag_id })))
  for (let i = 0; i < pares.length; i += LOTE_TAGS) {
    const { error } = await supabase
      .from('lead_tags')
      .upsert(pares.slice(i, i + LOTE_TAGS), { onConflict: 'lead_id,tag_id', ignoreDuplicates: true })
    if (error) {
      console.error('[leads-importar] erro ao aplicar tags:', resumoErro(error))
      return 'Os contatos foram importados, mas parte das tags não foi aplicada. Aplique pela ficha ou reimporte só as tags.'
    }
  }
  return null
}

/**
 * O trigger da 126 grava ganho_em = agora em todo INSERT com status 'ganho'.
 * Clientes antigos não fecharam hoje: sem a data real, ganho_em fica NULL (como
 * a 126 fez com os is_converted antigos) para não inflar "ganhos no período".
 * Mudar só ganho_em não dispara o trigger (ele é UPDATE OF stage_id, status).
 */
async function limparDataDeGanho(supabase: SupabaseClient, ids: string[]): Promise<string | null> {
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const { error } = await supabase.from('leads').update({ ganho_em: null }).in('id', ids.slice(i, i + LOTE_IDS))
    if (error) {
      console.error('[leads-importar] erro ao limpar ganho_em:', resumoErro(error))
      return 'Parte dos clientes ficou com a data de ganho de hoje; eles vão contar como ganhos deste período.'
    }
  }
  return null
}
