import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { canAccessUnit, isPerfilGestor } from '@/lib/auth/access'
import { gerarCsv } from '@/lib/csv'
import {
  SELECT_EXPORTACAO, cabecalhoExportacao, lerFiltrosExportacao, linhaExportacao, type LeadExportado,
} from '@/lib/exportacao'
import {
  SELECT_CONVERSAS_FUNIL, SELECT_TAGS_DOS_LEADS, montarResumoConversas, montarTagsDosLeads, unirEtiquetas,
  type ConversaFunil, type TagDoLeadFunil,
} from '@/lib/funil/resumo-conversas'
import { resumoErro } from '@/lib/log-seguro'
import type { CampoLead } from '@/types/database'

// GET /api/leads/exportar?funnel_id=&stage_ids=&responsavel_ids=&tag_ids=&cidade=&status=&clientes=1
// CSV dos leads da unidade ativa (só gestor/admin: é extração em massa de dado
// pessoal). Lê com o client do usuário (RLS) e pagina de 1000 em 1000, sem o
// corte silencioso do PostgREST. Tags = do lead + das conversas dele, como o
// filtro do funil.

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('perfil, unit_id').eq('id', user.id).single()
  const unitId = profile?.unit_id as string | null | undefined
  if (!profile || !isPerfilGestor(profile.perfil) || !unitId || !(await canAccessUnit(supabase, user.id, unitId))) {
    return NextResponse.json({ error: 'Só gestor ou admin exporta contatos' }, { status: 403 })
  }

  const filtros = lerFiltrosExportacao(req.nextUrl.searchParams)
  if (!filtros) return NextResponse.json({ error: 'Filtros inválidos' }, { status: 400 })

  const [leads, funis, etapas, motivos, campos, tagsDoLead, conversas] = await Promise.all([
    fetchAll<LeadExportado>((from, to) => {
      let q = supabase.from('leads').select(SELECT_EXPORTACAO).eq('unit_id', unitId)
      if (filtros.funnel_id) q = q.eq('funnel_id', filtros.funnel_id)
      if (filtros.stage_ids.length) q = q.in('stage_id', filtros.stage_ids)
      if (filtros.responsavel_ids.length) q = q.in('responsavel_id', filtros.responsavel_ids)
      if (filtros.cidade) q = q.ilike('cidade', `%${filtros.cidade.replace(/[%_\\]/g, '\\$&')}%`)
      if (filtros.status === 'nao_perdido') q = q.neq('status', 'perdido')
      else if (filtros.status !== 'todos') q = q.eq('status', filtros.status)
      if (filtros.clientes) q = q.eq('is_converted', true)
      return q.order('created_at', { ascending: false }).order('id').range(from, to).returns<LeadExportado[]>()
    }),
    supabase.from('funnels').select('id, nome').eq('unit_id', unitId),
    supabase.from('funnel_stages').select('id, nome').eq('unit_id', unitId),
    supabase.from('motivos_perda').select('id, nome').eq('unit_id', unitId),
    supabase.from('campos_lead').select('*').eq('unit_id', unitId).eq('ativo', true)
      .order('ordem').order('rotulo'),
    fetchAll<TagDoLeadFunil>((from, to) => supabase.from('lead_tags').select(SELECT_TAGS_DOS_LEADS)
      .eq('unit_id', unitId).order('lead_id').order('tag_id').range(from, to).returns<TagDoLeadFunil[]>()),
    fetchAll<ConversaFunil>((from, to) => supabase.from('wa_conversations').select(SELECT_CONVERSAS_FUNIL)
      .eq('unit_id', unitId).not('lead_id', 'is', null).order('id').range(from, to).returns<ConversaFunil[]>()),
  ])

  const erro = leads.error ?? funis.error ?? etapas.error ?? motivos.error ?? campos.error ?? tagsDoLead.error ?? conversas.error
  if (erro) {
    console.error('[leads-exportar] erro ao ler:', resumoErro(erro))
    return NextResponse.json({ error: 'Não foi possível montar o arquivo' }, { status: 500 })
  }

  const etiquetas = unirEtiquetas(montarTagsDosLeads(tagsDoLead.data), montarResumoConversas(conversas.data).tagsByLead)
  let lista = leads.data
  if (filtros.tag_ids.length) {
    lista = lista.filter(l => (etiquetas[l.id] ?? []).some(t => filtros.tag_ids.includes(t.id)))
  }

  const responsavelIds = [...new Set(lista.map(l => l.responsavel_id).filter((id): id is string => !!id))]
  const responsaveis = new Map<string, string>()
  for (let i = 0; i < responsavelIds.length; i += 200) {
    const { data } = await supabase.from('profiles').select('id, full_name').in('id', responsavelIds.slice(i, i + 200))
    for (const p of data ?? []) responsaveis.set(p.id as string, (p.full_name as string | null) ?? '')
  }

  const camposAtivos = (campos.data ?? []) as CampoLead[]
  const ctx = {
    campos:       camposAtivos,
    funis:        new Map((funis.data ?? []).map(f => [f.id as string, f.nome as string])),
    etapas:       new Map((etapas.data ?? []).map(e => [e.id as string, e.nome as string])),
    motivos:      new Map((motivos.data ?? []).map(m => [m.id as string, m.nome as string])),
    responsaveis,
    tagsPorLead:  new Map(Object.entries(etiquetas).map(([id, ts]) => [id, ts.map(t => t.name)])),
  }
  const csv = gerarCsv([cabecalhoExportacao(camposAtivos), ...lista.map(l => linhaExportacao(l, ctx))])

  // Registro sem dado pessoal: quem, de qual unidade, quantas linhas e quais filtros (só os nomes)
  const usados = Object.entries(filtros)
    .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== false && v !== 'todos'))
    .map(([k]) => k)
  console.info(`[leads-exportar] usuario=${user.id} unidade=${unitId} linhas=${lista.length} filtros=${usados.join(',') || 'nenhum'}`)

  const hoje = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="contatos-${hoje}.csv"`,
      'Cache-Control':       'no-store',
    },
  })
}
