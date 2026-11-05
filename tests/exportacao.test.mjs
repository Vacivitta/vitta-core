import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarCsv, lerCsv } from '../src/lib/csv.ts'
import {
  cabecalhoExportacao, dataBR, lerFiltrosExportacao, linhaExportacao, urlExportacao,
} from '../src/lib/exportacao.ts'

const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('filtros vão e voltam pela URL; valor inválido é recusado', () => {
  const url = urlExportacao({
    funnel_id: ID(1), stage_ids: [ID(2), ID(3)], tag_ids: [ID(4)], responsavel_ids: [], cidade: ' Itu ',
    status: 'nao_perdido', clientes: false,
  })
  assert.equal(url, `/api/leads/exportar?funnel_id=${ID(1)}&stage_ids=${ID(2)}%2C${ID(3)}&tag_ids=${ID(4)}&cidade=Itu&status=nao_perdido`)
  const f = lerFiltrosExportacao(new URL(url, 'http://x').searchParams)
  assert.deepEqual(f, {
    funnel_id: ID(1), stage_ids: [ID(2), ID(3)], responsavel_ids: [], tag_ids: [ID(4)], cidade: 'Itu',
    status: 'nao_perdido', clientes: false,
  })
  assert.equal(urlExportacao({ status: 'todos', clientes: true }), '/api/leads/exportar?clientes=1')
  assert.equal(lerFiltrosExportacao(new URLSearchParams('stage_ids=1,2')), null)
  assert.equal(lerFiltrosExportacao(new URLSearchParams('status=arquivado')), null)
  assert.equal(lerFiltrosExportacao(new URLSearchParams('funnel_id=x')), null)
  assert.equal(lerFiltrosExportacao(new URLSearchParams('')).status, 'todos')
})

test('data em dd/mm/aaaa no horário de Brasília', () => {
  assert.equal(dataBR('2026-11-04T02:30:00Z'), '03/11/2026')
  assert.equal(dataBR('x'), '')
})

test('linha exportada: nomes, status, motivo, cliente, tags, campos e proteção contra fórmula', () => {
  const campos = [
    { id: 'c1', unit_id: 'u', funnel_id: null, chave: 'valor', rotulo: 'Valor', ordem: 0, ativo: true, criado_em: '', tipo: 'moeda', opcoes: null },
    { id: 'c2', unit_id: 'u', funnel_id: null, chave: 'evento', rotulo: 'Evento', ordem: 1, ativo: true, criado_em: '', tipo: 'data', opcoes: null },
  ]
  const ctx = {
    campos,
    funis: new Map([['f', 'Vendas']]),
    etapas: new Map([['s', 'Perdido']]),
    motivos: new Map([['m', 'Outro']]),
    responsaveis: new Map([['r', 'Maria']]),
    tagsPorLead: new Map([['l1', ['VIP', 'Evento']]]),
  }
  const lead = {
    id: 'l1', nome: '=Ana', sobrenome: 'Silva', telefone: '+12125551234', email: 'ana@x.com', origem: 'Evento',
    cidade: 'Itu', funnel_id: 'f', stage_id: 's', status: 'perdido', motivo_perda_id: 'm', motivo_perda: 'mudou de cidade',
    is_converted: true, responsavel_id: 'r', campos: { valor: 1234.5, evento: '2026-03-05' }, created_at: '2026-01-10T15:00:00Z',
  }
  assert.deepEqual(cabecalhoExportacao(campos).slice(-3), ['Valor', 'Evento', 'Criado em'])
  const linha = linhaExportacao(lead, ctx)
  assert.deepEqual(linha.slice(0, 12), [
    '=Ana Silva', '+12125551234', 'ana@x.com', 'Evento', 'Itu', 'Vendas', 'Perdido', 'Perdido', 'Outro: mudou de cidade',
    'Sim', 'Maria', 'VIP, Evento',
  ])
  assert.equal(linha[12].replace(/\s/g, ' '), 'R$ 1.234,50')
  assert.equal(linha[13], '05/03/2026')
  assert.equal(linha[14], '10/01/2026')

  const csv = gerarCsv([cabecalhoExportacao(campos), linha])
  const [, lida] = lerCsv(csv).registros
  assert.equal(lida[0], "'=Ana Silva")
  assert.equal(lida[1], "'+12125551234")

  const aberto = linhaExportacao({ ...lead, status: 'aberto', is_converted: false, campos: null }, ctx)
  assert.equal(aberto[8], '')
  assert.equal(aberto[9], 'Não')
  assert.equal(aberto[12], '')
})
