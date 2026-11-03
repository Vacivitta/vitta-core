import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  atualizacaoAposLote, decidirLote, descreverStatus, inicioDoDiaSaoPaulo, lerEstadoCampanha, podeDisparar,
  proximaMeiaNoiteSaoPaulo,
} from '../src/lib/whatsapp/campanha-regras.ts'

const iso = d => d.toISOString()

test('início do dia de São Paulo', () => {
  // 23:30 de 03/11 em SP ainda é dia 03, embora já seja 04/11 em UTC
  assert.equal(iso(inicioDoDiaSaoPaulo(new Date('2026-11-04T02:30:00Z'))), '2026-11-03T03:00:00.000Z')
  assert.equal(iso(inicioDoDiaSaoPaulo(new Date('2026-11-04T03:00:00Z'))), '2026-11-04T03:00:00.000Z')
  assert.equal(iso(inicioDoDiaSaoPaulo(new Date('2026-11-04T02:59:59.999Z'))), '2026-11-03T03:00:00.000Z')
  assert.equal(iso(inicioDoDiaSaoPaulo(new Date('2027-01-01T01:00:00Z'))), '2026-12-31T03:00:00.000Z')
})

test('próxima meia-noite de São Paulo', () => {
  assert.equal(iso(proximaMeiaNoiteSaoPaulo(new Date('2026-11-03T15:00:00Z'))), '2026-11-04T03:00:00.000Z')
  assert.equal(iso(proximaMeiaNoiteSaoPaulo(new Date('2026-11-04T02:59:00Z'))), '2026-11-04T03:00:00.000Z')
  // exatamente à meia-noite, a próxima é a do dia seguinte
  assert.equal(iso(proximaMeiaNoiteSaoPaulo(new Date('2026-11-04T03:00:00Z'))), '2026-11-05T03:00:00.000Z')
  assert.equal(iso(proximaMeiaNoiteSaoPaulo(new Date('2026-12-31T20:00:00Z'))), '2027-01-01T03:00:00.000Z')
})

test('tamanho do lote pelo limite diário da unidade', () => {
  const agora = new Date('2026-11-03T15:00:00Z')
  const base = { pendentes: 500, lote: 10, limiteDiario: 250, agora }
  assert.deepEqual(decidirLote({ ...base, enviadosHojeNaUnidade: 0 }), { tipo: 'enviar', quantidade: 10 })
  assert.deepEqual(decidirLote({ ...base, enviadosHojeNaUnidade: 246 }), { tipo: 'enviar', quantidade: 4 })
  assert.deepEqual(decidirLote({ ...base, pendentes: 3, enviadosHojeNaUnidade: 0 }), { tipo: 'enviar', quantidade: 3 })
  assert.deepEqual(decidirLote({ ...base, enviadosHojeNaUnidade: 250 }),
    { tipo: 'limite_diario', retomarEm: new Date('2026-11-04T03:00:00Z') })
  assert.deepEqual(decidirLote({ ...base, enviadosHojeNaUnidade: 300 }),
    { tipo: 'limite_diario', retomarEm: new Date('2026-11-04T03:00:00Z') })
  assert.deepEqual(decidirLote({ ...base, pendentes: 0, enviadosHojeNaUnidade: 300 }), { tipo: 'concluida' })
})

test('campanha depois do lote: continua enviando, conclui ou pausa com motivo', () => {
  const agora = new Date('2026-11-03T15:00:00Z')
  const contagem = { enviados: 10, falhas: 0 }
  assert.deepEqual(atualizacaoAposLote({ tipo: 'continua', pendentes: 5, ...contagem }, agora),
    { status: 'enviando', motivo_pausa: null, retomar_em: null })
  assert.deepEqual(atualizacaoAposLote({ tipo: 'concluida', ...contagem }, agora),
    { status: 'concluida', motivo_pausa: null, retomar_em: null, completed_at: iso(agora) })
  assert.deepEqual(
    atualizacaoAposLote({ tipo: 'limite_diario', retomarEm: new Date('2026-11-04T03:00:00Z'), ...contagem }, agora),
    { status: 'pausada', motivo_pausa: 'limite_diario', retomar_em: '2026-11-04T03:00:00.000Z' })
  assert.deepEqual(atualizacaoAposLote({ tipo: 'pausada', motivo: 'autorizacao', detalhe: '401', ...contagem }, agora),
    { status: 'pausada', motivo_pausa: 'autorizacao', retomar_em: null })
  assert.equal(atualizacaoAposLote({ tipo: 'ocupada' }, agora), null)
  assert.equal(atualizacaoAposLote({ tipo: 'ignorada', status: 'pausada' }, agora), null)
})

test('disparar: agendada só depois da hora; enviando não dispara de novo', () => {
  const agora = new Date('2026-11-03T15:00:00Z')
  const agendada = at => lerEstadoCampanha({ status: 'agendada', scheduled_at: at })
  assert.deepEqual(podeDisparar(agendada('2026-11-03T14:59:00Z'), agora), { ok: true })
  assert.equal(podeDisparar(agendada('2026-11-03T15:01:00Z'), agora).ok, false)
  assert.equal(podeDisparar(lerEstadoCampanha({ status: 'enviando', scheduled_at: null }), agora).ok, false)
  assert.deepEqual(podeDisparar(lerEstadoCampanha({ status: 'pausada', scheduled_at: null, motivo_pausa: 'manual' }), agora),
    { ok: true })
  assert.equal(lerEstadoCampanha({ status: 'xyz', scheduled_at: null }), null)
})

test('texto do status', () => {
  const agora = new Date('2026-11-03T15:00:00Z')
  const progresso = { enviados: 40, total: 300 }
  assert.equal(descreverStatus({ status: 'enviando' }, progresso, agora), 'Enviando (40 de 300)')
  assert.equal(
    descreverStatus({ status: 'pausada', motivo: 'limite_diario', retomarEm: proximaMeiaNoiteSaoPaulo(agora) }, progresso, agora),
    'Limite diário atingido · retoma amanhã às 00:00')
  assert.equal(descreverStatus({ status: 'pausada', motivo: 'manual', retomarEm: null }, progresso, agora), 'Pausada manualmente')
  // agendada às 09:00 de São Paulo = 12:00 UTC
  assert.equal(descreverStatus({ status: 'agendada', agendadaPara: new Date('2026-11-04T12:00:00Z') }, progresso, agora),
    'Agendada para 04/11/2026, 09:00')
})
