import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  avancou, cicloDias, etapaDaPerda, indicadores, montarPainelNegocios, movimentosPorLead, passagemPorEtapa,
  perdasPorEtapa, perdasPorMotivo, rankingResponsaveis, taxa, tempoPorEtapa, valorGanho,
} from '../src/lib/dashboard/negocios.ts'
import { janelaDoPeriodo, lerFiltros, queryDosFiltros } from '../src/lib/dashboard/filtros.ts'

const AGORA = new Date('2026-11-04T12:00:00Z')
const MES = { desde: new Date('2026-10-05T12:00:00Z'), ate: AGORA }
const TUDO = { desde: null, ate: AGORA }
const HIST = new Date('2026-06-24T03:00:00Z').getTime()

function lead(over) {
  return {
    id: 'l', funnel_id: 'f', stage_id: 'novo', responsavel_id: 'ana', status: 'aberto',
    created_at: '2026-10-10T12:00:00Z', ganho_em: null, perdido_em: null, motivo: null, ...over,
  }
}
const mv = (lead_id, de, para, criado_em, movido_via = 'manual') => ({ lead_id, de_stage_id: de, para_stage_id: para, criado_em, movido_via })

const ETAPAS = [
  { id: 'novo',    funnel_id: 'f', nome: 'Novo',     cor: '#aaa', ordem: 0, resultado: null },
  { id: 'contato', funnel_id: 'f', nome: 'Contato',  cor: '#aaa', ordem: 1, resultado: null },
  { id: 'proposta', funnel_id: 'f', nome: 'Proposta', cor: '#aaa', ordem: 2, resultado: null },
  { id: 'ganho',   funnel_id: 'f', nome: 'Fechado',  cor: '#aaa', ordem: 3, resultado: 'ganho' },
  { id: 'perdido', funnel_id: 'f', nome: 'Perdido',  cor: '#aaa', ordem: 4, resultado: 'perdido' },
  { id: 'outro',   funnel_id: 'g', nome: 'Outro funil', cor: '#aaa', ordem: 9, resultado: null },
]
const POR_ID = new Map(ETAPAS.map(e => [e.id, e]))

test('taxa sem base é null, não zero nem NaN', () => {
  assert.equal(taxa(0, 0), null)
  assert.equal(taxa(3, 4), 0.75)
  assert.equal(taxa(0, 5), 0)
})

test('indicadores: período pelo campo certo e taxa de ganho só com fechados', () => {
  const leads = [
    lead({ id: 'a', status: 'ganho', ganho_em: '2026-10-20T12:00:00Z', created_at: '2026-10-10T12:00:00Z' }),
    lead({ id: 'b', status: 'ganho', ganho_em: null, created_at: '2025-01-01T00:00:00Z' }),       // cliente antigo
    lead({ id: 'c', status: 'perdido', perdido_em: '2026-10-21T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }),
    lead({ id: 'd', status: 'perdido', perdido_em: '2026-09-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }),
    lead({ id: 'e', status: 'aberto', ganho_em: '2026-10-25T00:00:00Z' }),                     // ganho e reaberto
    lead({ id: 'f', status: 'aberto' }),
  ]
  const r = indicadores(leads, MES)
  assert.equal(r.novos, 3)           // a, e, f criados no período
  assert.equal(r.ganhos, 1)          // b sem data e e reaberto ficam fora
  assert.equal(r.perdidos, 1)        // d perdeu antes do período
  assert.equal(r.abertos, 2)
  assert.equal(r.taxaGanho, 0.5)
  assert.equal(r.cicloMedioDias, 10)
  assert.equal(r.cicloBase, 1)
})

test('indicadores: "Tudo" conta ganho sem data, mas o ciclo ignora ganho_em nulo', () => {
  const leads = [
    lead({ id: 'a', status: 'ganho', ganho_em: '2026-10-20T12:00:00Z' }),
    lead({ id: 'b', status: 'ganho', ganho_em: null }),
  ]
  const r = indicadores(leads, TUDO)
  assert.equal(r.ganhos, 2)
  assert.equal(r.cicloBase, 1)
  assert.equal(r.cicloMedioDias, 10)
})

test('indicadores sem nada fechado: taxa e ciclo null', () => {
  const r = indicadores([lead({})], MES)
  assert.equal(r.taxaGanho, null)
  assert.equal(r.cicloMedioDias, null)
  assert.equal(indicadores([], MES).novos, 0)
})

test('ciclo: ganho_em nulo ou antes da criação não entra', () => {
  assert.equal(cicloDias(lead({ ganho_em: null })), null)
  assert.equal(cicloDias(lead({ ganho_em: '2026-10-01T00:00:00Z' })), null)
  assert.equal(cicloDias(lead({ ganho_em: '2026-10-10T12:00:00Z' })), 0)
})

test('valor ganho: último orçamento aceito por lead; ganho sem orçamento contado à parte', () => {
  const ganhos = [lead({ id: 'a', status: 'ganho' }), lead({ id: 'b', status: 'ganho' })]
  const r = valorGanho(ganhos, [
    { lead_id: 'a', status: 'aceito', total_calculado: 100, criado_em: '2026-01-01T00:00:00Z', aceito_em: '2026-01-02T00:00:00Z' },
    { lead_id: 'a', status: 'aceito', total_calculado: 300, criado_em: '2026-10-01T00:00:00Z', aceito_em: '2026-10-02T00:00:00Z' },
    { lead_id: 'a', status: 'recusado', total_calculado: 999, criado_em: '2026-10-03T00:00:00Z', aceito_em: null },
    { lead_id: 'b', status: 'enviado', total_calculado: 50, criado_em: '2026-10-03T00:00:00Z', aceito_em: null },
    { lead_id: null, status: 'aceito', total_calculado: 70, criado_em: '2026-10-03T00:00:00Z', aceito_em: null },
  ])
  assert.deepEqual(r, { total: 300, comOrcamento: 1, semOrcamento: 1 })
})

test('perdas por motivo: sem motivo vira "Não informado"', () => {
  const leads = [
    lead({ id: 'a', status: 'perdido', perdido_em: '2026-10-20T00:00:00Z', motivo: 'Outro' }),
    lead({ id: 'b', status: 'perdido', perdido_em: '2026-10-20T00:00:00Z', motivo: 'Outro' }),
    lead({ id: 'c', status: 'perdido', perdido_em: '2026-10-20T00:00:00Z', motivo: null }),
    lead({ id: 'd', status: 'perdido', perdido_em: '2026-01-20T00:00:00Z', motivo: 'Timing ruim' }),
  ]
  assert.deepEqual(perdasPorMotivo(leads, MES), [{ rotulo: 'Outro', total: 2 }, { rotulo: 'Não informado', total: 1 }])
})

test('etapa da perda: atual, ou a de origem quando foi movido para "Perdido"', () => {
  assert.equal(etapaDaPerda(lead({ stage_id: 'proposta' }), [], POR_ID), 'proposta')
  const movs = [mv('l', 'novo', 'contato', '2026-10-11T00:00:00Z'), mv('l', 'contato', 'perdido', '2026-10-12T00:00:00Z')]
  assert.equal(etapaDaPerda(lead({ stage_id: 'perdido' }), movs, POR_ID), 'contato')
  assert.equal(etapaDaPerda(lead({ stage_id: 'perdido' }), [], POR_ID), null)
  assert.equal(etapaDaPerda(lead({ stage_id: null }), [], POR_ID), null)

  const perdidos = [
    lead({ id: 'l', stage_id: 'perdido', status: 'perdido', perdido_em: '2026-10-12T00:00:00Z' }),
    lead({ id: 'x', stage_id: 'perdido', status: 'perdido', perdido_em: '2026-10-12T00:00:00Z' }),
  ]
  assert.deepEqual(perdasPorEtapa(perdidos, movimentosPorLead(movs), POR_ID, MES),
    [{ rotulo: 'Contato', total: 1 }, { rotulo: 'Etapa não registrada', total: 1 }])
})

test('avançar: ordem maior no mesmo funil; perda nunca; ganho sempre', () => {
  assert.equal(avancou(POR_ID.get('novo'), POR_ID.get('contato')), true)
  assert.equal(avancou(POR_ID.get('proposta'), POR_ID.get('contato')), false)
  assert.equal(avancou(POR_ID.get('proposta'), POR_ID.get('perdido')), false)
  assert.equal(avancou(POR_ID.get('proposta'), POR_ID.get('ganho')), true)
  assert.equal(avancou(POR_ID.get('novo'), POR_ID.get('outro')), false)
})

test('passagem: lead que pulou etapa avança da origem e não entra na pulada', () => {
  const l = lead({ id: 'l', stage_id: 'proposta', created_at: '2026-10-10T00:00:00Z' })
  const movs = movimentosPorLead([mv('l', 'novo', 'proposta', '2026-10-11T00:00:00Z')])
  const p = passagemPorEtapa([l], movs, POR_ID, MES, HIST)
  assert.deepEqual(p.get('novo'), { entraram: 1, avancaram: 1, taxa: 1 })   // entrada inferida na criação
  assert.equal(p.get('contato'), undefined)
  assert.deepEqual(p.get('proposta'), { entraram: 1, avancaram: 0, taxa: 0 })
})

test('passagem: reabertura não é entrada; voltar e perder não é avanço; ganho pela ficha é', () => {
  const leads = [
    // entrou em contato, voltou para novo e foi perdido
    lead({ id: 'a', stage_id: 'perdido', status: 'perdido', perdido_em: '2026-10-15T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }),
    // reaberto em novo: não conta como entrada em novo
    lead({ id: 'b', stage_id: 'novo', created_at: '2026-01-01T00:00:00Z' }),
    // entrou em proposta e foi marcado ganho sem mudar de etapa
    lead({ id: 'c', stage_id: 'proposta', status: 'ganho', ganho_em: '2026-10-20T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }),
  ]
  const movs = movimentosPorLead([
    mv('a', 'novo', 'contato', '2026-10-11T00:00:00Z'),
    mv('a', 'contato', 'novo', '2026-10-12T00:00:00Z'),
    mv('a', 'novo', 'perdido', '2026-10-15T00:00:00Z'),
    mv('b', 'perdido', 'novo', '2026-10-13T00:00:00Z', 'reabertura'),
    mv('c', 'contato', 'proposta', '2026-10-14T00:00:00Z'),
  ])
  const p = passagemPorEtapa(leads, movs, POR_ID, MES, HIST)
  assert.deepEqual(p.get('contato'), { entraram: 1, avancaram: 0, taxa: 0 })
  assert.deepEqual(p.get('novo'), { entraram: 1, avancaram: 0, taxa: 0 })     // só "a" (voltou), "b" é reabertura
  assert.deepEqual(p.get('proposta'), { entraram: 1, avancaram: 1, taxa: 1 })
  assert.equal(p.get('perdido'), undefined)
})

test('passagem: entrada fora do período não conta; lead antigo não ganha entrada inferida', () => {
  const l = lead({ id: 'l', stage_id: 'contato', created_at: '2026-05-01T00:00:00Z' })
  const movs = movimentosPorLead([mv('l', 'novo', 'contato', '2026-09-01T00:00:00Z')])
  assert.equal(passagemPorEtapa([l], movs, POR_ID, MES, HIST).size, 0)
  const tudo = passagemPorEtapa([l], movs, POR_ID, TUDO, HIST)
  assert.equal(tudo.get('novo'), undefined)                                  // criado antes do histórico
  assert.deepEqual(tudo.get('contato'), { entraram: 1, avancaram: 0, taxa: 0 })
})

test('tempo na etapa: da entrada até a saída no período; saída por reabertura não conta', () => {
  const leads = [
    lead({ id: 'a', stage_id: 'proposta', created_at: '2026-10-10T00:00:00Z' }),
    lead({ id: 'b', stage_id: 'novo', created_at: '2026-01-01T00:00:00Z' }),
  ]
  const movs = movimentosPorLead([
    mv('a', 'novo', 'contato', '2026-10-11T00:00:00Z'),      // 24h em novo
    mv('a', 'contato', 'proposta', '2026-10-11T12:00:00Z'),  // 12h em contato
    mv('b', 'novo', 'perdido', '2026-10-12T00:00:00Z'),      // b sem entrada conhecida em novo
    mv('b', 'perdido', 'novo', '2026-10-20T00:00:00Z', 'reabertura'),
  ])
  const t = tempoPorEtapa(leads, movs, MES, HIST)
  assert.deepEqual(t.get('novo'), { mediaHoras: 24, saidas: 1 })
  assert.deepEqual(t.get('contato'), { mediaHoras: 12, saidas: 1 })
  assert.equal(t.get('perdido'), undefined)
})

test('ranking por responsável: ganhos, perdidos e taxa; sem responsável fica com id null', () => {
  const leads = [
    lead({ id: 'a', responsavel_id: 'ana', status: 'ganho', ganho_em: '2026-10-20T00:00:00Z' }),
    lead({ id: 'b', responsavel_id: 'ana', status: 'perdido', perdido_em: '2026-10-20T00:00:00Z' }),
    lead({ id: 'c', responsavel_id: 'bia', status: 'ganho', ganho_em: '2026-10-20T00:00:00Z' }),
    lead({ id: 'd', responsavel_id: 'bia', status: 'ganho', ganho_em: '2026-10-21T00:00:00Z' }),
    lead({ id: 'e', responsavel_id: null, status: 'perdido', perdido_em: '2026-10-20T00:00:00Z' }),
    lead({ id: 'f', responsavel_id: 'caio', status: 'aberto' }),
  ]
  assert.deepEqual(rankingResponsaveis(leads, MES), [
    { responsavel_id: 'bia', ganhos: 2, perdidos: 0, taxa: 1 },
    { responsavel_id: 'ana', ganhos: 1, perdidos: 1, taxa: 0.5 },
    { responsavel_id: null, ganhos: 0, perdidos: 1, taxa: 0 },
  ])
})

test('painel: abertos por etapa e movimentos de leads fora do filtro ignorados', () => {
  const painel = montarPainelNegocios({
    leads: [lead({ id: 'a', stage_id: 'contato' }), lead({ id: 'b', stage_id: 'contato', status: 'perdido', perdido_em: '2026-10-20T00:00:00Z' })],
    movimentos: [mv('a', 'novo', 'contato', '2026-10-11T00:00:00Z'), mv('zz', 'novo', 'contato', '2026-10-11T00:00:00Z')],
    etapas: ETAPAS,
    funis: [{ id: 'f', nome: 'Vendas' }, { id: 'vazio', nome: 'Sem etapas' }],
    orcamentos: [],
    janela: MES,
  })
  assert.equal(painel.funis.length, 1)
  const contato = painel.funis[0].etapas.find(e => e.id === 'contato')
  assert.equal(contato.abertos, 1)
  assert.equal(contato.entraram, 2)                                        // a por movimento, b criado nela
  assert.deepEqual(painel.perdasPorEtapa, [{ rotulo: 'Contato', total: 1 }])
})

test('filtros da URL: valores inválidos caem no padrão', () => {
  const validos = { funis: ['f1'], responsaveis: ['u1'] }
  assert.deepEqual(lerFiltros({}, validos), { periodo: '30d', funilId: null, responsavelId: null })
  assert.deepEqual(lerFiltros({ periodo: '90d', funil: 'f1', responsavel: ['u1', 'u2'] }, validos),
    { periodo: '90d', funilId: 'f1', responsavelId: 'u1' })
  assert.deepEqual(lerFiltros({ periodo: '1y', funil: 'outro', responsavel: '' }, validos),
    { periodo: '30d', funilId: null, responsavelId: null })
  assert.equal(queryDosFiltros({ periodo: '30d', funilId: null, responsavelId: null }), '')
  assert.equal(queryDosFiltros({ periodo: 'all', funilId: 'f1', responsavelId: 'u1' }), '?periodo=all&funil=f1&responsavel=u1')
  assert.deepEqual(janelaDoPeriodo('7d', AGORA), { desde: new Date('2026-10-28T12:00:00Z'), ate: AGORA })
  assert.deepEqual(janelaDoPeriodo('all', AGORA), { desde: null, ate: AGORA })
})
