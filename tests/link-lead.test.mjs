import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkDoLead } from '../src/lib/funil/link-lead.ts'

const ID = '0b8f3c2e-1d4a-4e5b-9c6d-7e8f9a0b1c2d'

test('link de notificação abre o lead e a aba pedida', () => {
  assert.deepEqual(linkDoLead({ lead: ID }), { leadId: ID, aba: null })
  assert.deepEqual(linkDoLead({ lead: ID, tab: 'Anotações' }), { leadId: ID, aba: 'Anotações' })
  assert.deepEqual(linkDoLead({ lead: [ID.toUpperCase(), 'x'] }), { leadId: ID, aba: null })
})

test('link sem lead ou com id inválido é ignorado', () => {
  assert.equal(linkDoLead({}), null)
  assert.equal(linkDoLead({ lead: '' }), null)
  assert.equal(linkDoLead({ lead: 'abc' }), null)
  assert.equal(linkDoLead({ lead: `${ID}' or 1=1` }), null)
})
