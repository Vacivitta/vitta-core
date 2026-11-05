import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarResumoConversas, montarTagsDosLeads, unirEtiquetas } from '../src/lib/funil/resumo-conversas.ts'

const vip      = { id: 't1', name: 'VIP', color: '#111111' }
const gestante = { id: 't2', name: 'Gestante', color: '#222222' }
const retorno  = { id: 't3', name: 'Retorno', color: '#333333' }

function conversa(id, leadId, tags) {
  return { id, lead_id: leadId, unread_count: 0, last_message_at: null, last_message_direction: null, tags: tags.map(tag => ({ tag })) }
}

test('etiquetas de todas as conversas do lead, sem repetir', () => {
  const r = montarResumoConversas([
    conversa('c1', 'L1', [vip, gestante]),
    conversa('c2', 'L1', [vip, retorno]),
    conversa('c3', null, [retorno]),
  ])
  assert.deepEqual(r.tagsByLead, { L1: [vip, gestante, retorno] })
})

test('tags do lead vêm antes das das conversas e não repetem', () => {
  const doLead = montarTagsDosLeads([
    { lead_id: 'L1', tag: retorno },
    { lead_id: 'L2', tag: vip },
    { lead_id: 'L3', tag: null },
  ])
  const dasConversas = { L1: [vip, retorno], L4: [gestante] }
  assert.deepEqual(unirEtiquetas(doLead, dasConversas), {
    L1: [retorno, vip],
    L2: [vip],
    L4: [gestante],
  })
})

test('unirEtiquetas não altera os mapas de entrada', () => {
  const doLead = { L1: [vip] }
  const dasConversas = { L1: [gestante] }
  unirEtiquetas(doLead, dasConversas)
  assert.deepEqual(doLead, { L1: [vip] })
  assert.deepEqual(dasConversas, { L1: [gestante] })
})
