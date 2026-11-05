import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparPorTipo, lerTipoTag, ROTULO_TIPO_TAG, tagsDoTipo } from '../src/lib/tags.ts'

const TAGS = [
  { id: 'a', name: 'Urgente', tipo: 'conversa' },
  { id: 'b', name: 'VIP', tipo: 'lead' },
  { id: 'c', name: 'VIP', tipo: 'conversa' },
  { id: 'd', name: 'Gestante', tipo: 'lead' },
]

test('tipo vindo da requisição: só lead ou conversa', () => {
  assert.equal(lerTipoTag('lead'), 'lead')
  assert.equal(lerTipoTag('conversa'), 'conversa')
  for (const invalido of [null, undefined, '', 'cliente', 'LEAD', 1]) assert.equal(lerTipoTag(invalido), null)
})

test('catálogo do alvo: ficha recebe só as de cliente, conversa só as de conversa', () => {
  assert.deepEqual(tagsDoTipo(TAGS, 'lead').map(t => t.id), ['b', 'd'])
  assert.deepEqual(tagsDoTipo(TAGS, 'conversa').map(t => t.id), ['a', 'c'])
})

test('filtro do funil: Cliente antes de Conversa, ordem interna mantida, sem grupo vazio', () => {
  assert.deepEqual(agruparPorTipo(TAGS).map(g => [g.rotulo, g.tags.map(t => t.id)]), [
    ['Cliente', ['b', 'd']],
    ['Conversa', ['a', 'c']],
  ])
  assert.deepEqual(agruparPorTipo(tagsDoTipo(TAGS, 'conversa')).map(g => g.tipo), ['conversa'])
  assert.deepEqual(agruparPorTipo([]), [])
  assert.deepEqual(ROTULO_TIPO_TAG, { lead: 'Cliente', conversa: 'Conversa' })
})
