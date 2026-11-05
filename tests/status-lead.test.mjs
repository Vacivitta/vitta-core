import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  etapaAoGanhar, etapaAoPerder, etapaAoReabrir, gravacaoPerda, motivoArquivamento, motivoParaAgrupar, reaberturaPorMensagem,
  rotuloMotivoPerda,
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

test('marcar perdido leva para a etapa de perda do funil', () => {
  const etapas = [
    { id: 'novo', ordem: 0, resultado: null },
    { id: 'perdido-b', ordem: 4, resultado: 'perdido' },
    { id: 'perdido-a', ordem: 3, resultado: 'perdido' },
    { id: 'fechado', ordem: 2, resultado: 'ganho' },
  ]
  assert.equal(etapaAoPerder({ id: 'novo', resultado: null }, etapas), 'perdido-a')
  assert.equal(etapaAoPerder({ id: 'fechado', resultado: 'ganho' }, etapas), 'perdido-a')
  assert.equal(etapaAoPerder(null, etapas), 'perdido-a')
  // Já numa etapa de perda (mesmo não a primeira): fica onde está
  assert.equal(etapaAoPerder({ id: 'perdido-b', resultado: 'perdido' }, etapas), null)
  // Funil sem etapa de perda: o lead fica na coluna onde está, com o selo Perdido
  assert.equal(etapaAoPerder({ id: 'novo', resultado: null }, etapas.filter(s => s.resultado !== 'perdido')), null)
})

test('marcar ganho leva para a etapa de ganho do funil', () => {
  const etapas = [
    { id: 'novo', ordem: 0, resultado: null },
    { id: 'ganho-b', ordem: 4, resultado: 'ganho' },
    { id: 'ganho-a', ordem: 2, resultado: 'ganho' },
    { id: 'perdido', ordem: 3, resultado: 'perdido' },
  ]
  assert.equal(etapaAoGanhar({ id: 'novo', resultado: null }, etapas), 'ganho-a')
  assert.equal(etapaAoGanhar({ id: 'perdido', resultado: 'perdido' }, etapas), 'ganho-a')
  assert.equal(etapaAoGanhar(null, etapas), 'ganho-a')
  // Já numa etapa de ganho (mesmo não a primeira): fica onde está
  assert.equal(etapaAoGanhar({ id: 'ganho-b', resultado: 'ganho' }, etapas), null)
  // Funil sem etapa de ganho: o lead fica na coluna onde está, com o selo Ganho
  assert.equal(etapaAoGanhar({ id: 'novo', resultado: null }, etapas.filter(s => s.resultado !== 'ganho')), null)
})

test('mensagem recebida reabre ganho e perdido na etapa padrão', () => {
  const destino = { funnel_id: 'f1', stage_id: 's1' }
  assert.equal(reaberturaPorMensagem({ status: 'aberto', stage_id: 's9', arquivado: false }, destino), null)
  for (const status of ['ganho', 'perdido']) {
    assert.deepEqual(reaberturaPorMensagem({ status, stage_id: 's9', arquivado: false }, destino), {
      valores: { status: 'aberto', funnel_id: 'f1', stage_id: 's1' },
      historico: { de: 's9', para: 's1' },
    })
  }
  assert.deepEqual(reaberturaPorMensagem({ status: 'perdido', stage_id: 's1', arquivado: false }, destino),
    { valores: { status: 'aberto', funnel_id: 'f1', stage_id: 's1' }, historico: null })
  assert.deepEqual(reaberturaPorMensagem({ status: 'ganho', stage_id: 's9', arquivado: false }, null),
    { valores: { status: 'aberto' }, historico: null })
})

test('mensagem recebida desarquiva (aberto, ganho ou perdido) e leva para a etapa padrão', () => {
  const destino = { funnel_id: 'f1', stage_id: 's1' }
  for (const status of ['aberto', 'ganho', 'perdido']) {
    assert.deepEqual(reaberturaPorMensagem({ status, stage_id: 's9', arquivado: true }, destino), {
      valores: { status: 'aberto', arquivado_em: null, funnel_id: 'f1', stage_id: 's1' },
      historico: { de: 's9', para: 's1' },
    })
  }
  assert.deepEqual(reaberturaPorMensagem({ status: 'aberto', stage_id: 's1', arquivado: true }, destino),
    { valores: { status: 'aberto', arquivado_em: null, funnel_id: 'f1', stage_id: 's1' }, historico: null })
  assert.deepEqual(reaberturaPorMensagem({ status: 'aberto', stage_id: 's9', arquivado: true }, null),
    { valores: { status: 'aberto', arquivado_em: null }, historico: null })
})

test('arquivar exige motivo da lista, e "Outro" exige descrição', () => {
  assert.deepEqual(motivoArquivamento(null, 'x'), { ok: false, erro: 'Escolha um motivo' })
  assert.deepEqual(motivoArquivamento('Outro', '   '), { ok: false, erro: 'Descreva o motivo' })
  assert.deepEqual(motivoArquivamento('Outro', '  irmão do  dono '), { ok: true, texto: 'Outro: irmão do dono' })
  assert.deepEqual(motivoArquivamento('Spam', ''), { ok: true, texto: 'Spam' })
  assert.deepEqual(motivoArquivamento('Duplicado', 'do João'), { ok: true, texto: 'Duplicado: do João' })
  assert.equal(motivoArquivamento('Spam', 'x'.repeat(301)).ok, false)
})
