import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  etapaAoReabrir, gravacaoPerda, motivoParaAgrupar, reaberturaPorMensagem, rotuloMotivoPerda,
} from '../src/lib/status-lead.ts'

test('perda exige motivo, e "Outro" exige detalhe', () => {
  assert.deepEqual(gravacaoPerda(null, 'qualquer'), { ok: false, erro: 'Escolha um motivo' })
  assert.deepEqual(gravacaoPerda({ id: 'o', nome: 'Outro' }, '   '), { ok: false, erro: 'Descreva o motivo' })
  assert.deepEqual(gravacaoPerda({ id: 'o', nome: 'Outro' }, ' spam '),
    { ok: true, valores: { status: 'perdido', motivo_perda_id: 'o', motivo_perda: 'spam' } })
  assert.deepEqual(gravacaoPerda({ id: 's', nome: 'Sem interesse' }, ''),
    { ok: true, valores: { status: 'perdido', motivo_perda_id: 's', motivo_perda: null } })
})

test('rótulo e agrupamento do motivo', () => {
  assert.equal(rotuloMotivoPerda('Outro', 'spam'), 'Outro: spam')
  assert.equal(rotuloMotivoPerda('Sem interesse', null), 'Sem interesse')
  assert.equal(rotuloMotivoPerda(null, 'Orçamento recusado: caro'), 'Orçamento recusado: caro')
  assert.equal(rotuloMotivoPerda(null, ' '), null)
  assert.equal(motivoParaAgrupar('Timing ruim', 'x'), 'Timing ruim')
  assert.equal(motivoParaAgrupar(null, 'Movido para a etapa Perdido'), 'Outro')
  assert.equal(motivoParaAgrupar(null, null), null)
})

test('reabrir pela ficha sai da etapa com resultado', () => {
  const etapas = [
    { id: 'perdido', ordem: 3, resultado: 'perdido' },
    { id: 'novo', ordem: 0, resultado: null },
    { id: 'negociacao', ordem: 1, resultado: null },
    { id: 'fechado', ordem: 2, resultado: 'ganho' },
  ]
  assert.equal(etapaAoReabrir({ id: 'perdido', resultado: 'perdido' }, etapas), 'novo')
  assert.equal(etapaAoReabrir({ id: 'fechado', resultado: 'ganho' }, etapas), 'novo')
  assert.equal(etapaAoReabrir({ id: 'negociacao', resultado: null }, etapas), null)
  assert.equal(etapaAoReabrir(null, etapas), null)
  assert.equal(etapaAoReabrir({ id: 'perdido', resultado: 'perdido' }, [{ id: 'perdido', ordem: 0, resultado: 'perdido' }]), null)
})

test('mensagem recebida reabre ganho e perdido na etapa padrão', () => {
  const destino = { funnel_id: 'f1', stage_id: 's1' }
  assert.equal(reaberturaPorMensagem({ status: 'aberto', stage_id: 's9' }, destino), null)
  for (const status of ['ganho', 'perdido']) {
    assert.deepEqual(reaberturaPorMensagem({ status, stage_id: 's9' }, destino), {
      valores: { status: 'aberto', funnel_id: 'f1', stage_id: 's1' },
      historico: { de: 's9', para: 's1' },
    })
  }
  assert.deepEqual(reaberturaPorMensagem({ status: 'perdido', stage_id: 's1' }, destino),
    { valores: { status: 'aberto', funnel_id: 'f1', stage_id: 's1' }, historico: null })
  assert.deepEqual(reaberturaPorMensagem({ status: 'ganho', stage_id: 's9' }, null),
    { valores: { status: 'aberto' }, historico: null })
})
