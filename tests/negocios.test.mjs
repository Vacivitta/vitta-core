import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acaoDaMensagem, escolherNegocio } from '../src/lib/negocios.ts'

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
