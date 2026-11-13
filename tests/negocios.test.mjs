import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acaoDaMensagem, escolherNegocio, ganhoForaDoQuadro, DIAS_ATENDIMENTO_APOS_GANHO, DIAS_GANHO_NO_QUADRO } from '../src/lib/negocios.ts'

const n = (id, status, created_at, arquivado = false) => ({ id, status, created_at, arquivado, stage_id: 's' })

test('mensagem vai para o negócio aberto mais recente', () => {
  const r = acaoDaMensagem([
    n('ganho', 'ganho', '2026-01-01'), n('aberto-velho', 'aberto', '2026-02-01'),
    n('aberto-novo', 'aberto', '2026-03-01'), n('arquivado', 'aberto', '2026-04-01', true),
  ])
  assert.equal(r.tipo, 'usar')
  assert.equal(r.negocio.id, 'aberto-novo')
})

test('só aberto arquivado: desarquiva em vez de abrir outro', () => {
  const r = acaoDaMensagem([n('perdido', 'perdido', '2026-05-01'), n('arquivado', 'aberto', '2026-01-01', true)])
  assert.equal(r.tipo, 'desarquivar')
  assert.equal(r.negocio.id, 'arquivado')
})

test('só ganhos e perdidos (arquivados ou não), ou nenhum: negócio novo', () => {
  assert.deepEqual(acaoDaMensagem([n('g', 'ganho', '2026-01-01'), n('p', 'perdido', '2026-02-01', true)]), { tipo: 'novo' })
  assert.deepEqual(acaoDaMensagem([]), { tipo: 'novo' })
})

test('negócio que representa o contato: aberto, depois não arquivado, depois o mais recente', () => {
  assert.equal(escolherNegocio([n('g', 'ganho', '2026-05-01'), n('a', 'aberto', '2026-01-01')]).id, 'a')
  assert.equal(escolherNegocio([n('arq', 'aberto', '2026-05-01', true), n('g', 'ganho', '2026-01-01')]).id, 'g')
  assert.equal(escolherNegocio([n('p1', 'perdido', '2026-01-01', true), n('p2', 'perdido', '2026-02-01', true)]).id, 'p2')
  assert.equal(escolherNegocio([]), null)
})

const AGORA = Date.parse('2026-11-13T15:00:00Z')
const DIA = 24 * 60 * 60 * 1000
const g = (id, diasAtras, arquivado = false) =>
  ({ ...n(id, 'ganho', '2026-01-01', arquivado), ganho_em: new Date(AGORA - diasAtras * DIA).toISOString() })

test('mensagem depois do ganho recente vai para o negócio ganho (agendar doses), sem abrir outro', () => {
  const r = acaoDaMensagem([g('ganho-velho', 300), g('ganho-recente', 0.01), n('p', 'perdido', '2026-11-01')], AGORA)
  assert.equal(r.tipo, 'usar')
  assert.equal(r.negocio.id, 'ganho-recente')
})

test('ganho antigo, arquivado ou sem data não segura a mensagem: negócio novo', () => {
  assert.deepEqual(acaoDaMensagem([g('velho', DIAS_ATENDIMENTO_APOS_GANHO + 1)], AGORA), { tipo: 'novo' })
  assert.deepEqual(acaoDaMensagem([g('arq', 1, true)], AGORA), { tipo: 'novo' })
  assert.deepEqual(acaoDaMensagem([{ ...n('sem-data', 'ganho', '2026-11-01'), ganho_em: null }], AGORA), { tipo: 'novo' })
})

test('negócio aberto continua tendo prioridade sobre o ganho recente', () => {
  const r = acaoDaMensagem([g('ganho', 1), n('aberto', 'aberto', '2026-01-01')], AGORA)
  assert.equal(r.negocio.id, 'aberto')
})

test('ganho sai do quadro depois de DIAS_GANHO_NO_QUADRO dias', () => {
  assert.equal(ganhoForaDoQuadro(g('x', DIAS_GANHO_NO_QUADRO - 1), AGORA), false)
  assert.equal(ganhoForaDoQuadro(g('x', DIAS_GANHO_NO_QUADRO + 1), AGORA), true)
  assert.equal(ganhoForaDoQuadro({ status: 'aberto', ganho_em: null }, AGORA), false)
})
