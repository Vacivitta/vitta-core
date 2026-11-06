import { test } from 'node:test'
import assert from 'node:assert/strict'
import { corDoAutor, nomeDaConversa, participantesDoGrupo, telefoneDoParticipante } from '../src/lib/grupos.ts'

test('participantes do grupo: por telefone, nome mais recente, quem falou por último primeiro', () => {
  const msgs = [
    { direction: 'inbound', autor_telefone: '5511900000001', autor_nome: 'Ana', created_at: '2026-11-06T10:00:00Z' },
    { direction: 'inbound', autor_telefone: '5511900000002', autor_nome: 'Bruno', created_at: '2026-11-06T10:05:00Z' },
    { direction: 'inbound', autor_telefone: '5511900000001', autor_nome: 'Ana Licenciada', created_at: '2026-11-06T10:10:00Z' },
    { direction: 'inbound', autor_telefone: null, autor_nome: 'Só LID', created_at: '2026-11-06T10:11:00Z' },
    { direction: 'outbound', autor_telefone: null, autor_nome: null, created_at: '2026-11-06T10:12:00Z' },
  ]
  assert.deepEqual(participantesDoGrupo(msgs), [
    { telefone: '5511900000001', nome: 'Ana Licenciada', ultimaEm: '2026-11-06T10:10:00Z' },
    { telefone: '5511900000002', nome: 'Bruno', ultimaEm: '2026-11-06T10:05:00Z' },
  ])
  assert.deepEqual(participantesDoGrupo([]), [])
})

test('mensagem antiga não troca o nome mais recente', () => {
  const msgs = [
    { direction: 'inbound', autor_telefone: '5511900000001', autor_nome: 'Novo', created_at: '2026-11-06T10:10:00Z' },
    { direction: 'inbound', autor_telefone: '5511900000001', autor_nome: 'Antigo', created_at: '2026-11-06T09:00:00Z' },
  ]
  assert.equal(participantesDoGrupo(msgs)[0].nome, 'Novo')
})

test('cor do autor é estável e da paleta', () => {
  assert.equal(corDoAutor('5511900000001'), corDoAutor('5511900000001'))
  assert.match(corDoAutor('x'), /^#[0-9A-F]{6}$/)
})

test('nome da conversa: grupo pelo nome do grupo; individual pelo lead, contato ou telefone', () => {
  assert.equal(nomeDaConversa({ tipo: 'grupo', wa_contact_name: 'Licenciados', wa_phone: '1203' }, 'Lead'), 'Licenciados')
  assert.equal(nomeDaConversa({ tipo: 'grupo', wa_contact_name: null, wa_phone: '1203' }, null), 'Grupo sem nome')
  assert.equal(nomeDaConversa({ tipo: 'individual', wa_contact_name: 'Zé', wa_phone: '55' }, 'Lead'), 'Lead')
  assert.equal(nomeDaConversa({ wa_contact_name: null, wa_phone: '55' }, null), '55')
  assert.equal(telefoneDoParticipante('5511900000001'), '+5511900000001')
})
