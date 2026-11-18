import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortKanbanLeads } from '../src/components/kanban/sort.ts'

const lead = (id, extra = {}) => ({
  id, nome: id, sobrenome: null, ordem: 0,
  created_at: '2026-01-01T00:00:00Z', stage_changed_at: '2026-01-01T00:00:00Z', ...extra,
})
const ctx = (lastMsgByLead = {}, unreadByLead = {}) => ({ unreadByLead, lastMsgByLead, lastDirByLead: {} })

test('atividade: lead sem conversa recém-transferido fica no topo, pela entrada na etapa', () => {
  const leads = [
    lead('antigo'),
    lead('transferido', { stage_changed_at: '2026-11-13T12:00:00Z' }),
    lead('conversa'),
  ]
  const ordem = sortKanbanLeads(leads, 'atividade', ctx({ conversa: '2026-11-13T10:00:00Z' })).map(l => l.id)
  assert.deepEqual(ordem, ['transferido', 'conversa', 'antigo'])
})

test('atividade: não lidas continuam acima de tudo', () => {
  const leads = [lead('transferido', { stage_changed_at: '2026-11-13T12:00:00Z' }), lead('naoLida')]
  const ordem = sortKanbanLeads(leads, 'atividade', ctx({ naoLida: '2026-11-01T00:00:00Z' }, { naoLida: 2 })).map(l => l.id)
  assert.deepEqual(ordem, ['naoLida', 'transferido'])
})
