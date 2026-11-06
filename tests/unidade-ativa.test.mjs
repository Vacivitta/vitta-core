import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entradaAposLogin, unidadeDaAba } from '../src/lib/unidade-ativa.ts'

test('a aba usa a unidade que pediu, se o usuário está nela', () => {
  assert.equal(unidadeDaAba('salto', 'itu', ['itu', 'salto']), 'salto')
})

test('sem pedido, ou pedido de unidade sem vínculo, fica a última usada', () => {
  assert.equal(unidadeDaAba(null, 'itu', ['itu', 'salto']), 'itu', 'aba nova')
  assert.equal(unidadeDaAba('comercial', 'itu', ['itu', 'salto']), 'itu', 'cookie de unidade sem vínculo')
  assert.equal(unidadeDaAba('salto', 'itu', []), 'itu', 'admin da marca sem vínculos')
})

test('login com uma unidade entra direto nela, mesmo que a última gravada seja outra', () => {
  assert.deepEqual(entradaAposLogin(['itu'], 'salto'), { unidade: 'itu', destino: '/funil' })
})

test('login com várias unidades entra na caixa de todas, na última usada', () => {
  assert.deepEqual(entradaAposLogin(['itu', 'salto'], 'salto'), { unidade: 'salto', destino: '/atendimento' })
  assert.deepEqual(entradaAposLogin(['itu', 'salto'], 'comercial'), { unidade: 'itu', destino: '/atendimento' }, 'última sem vínculo')
  assert.deepEqual(entradaAposLogin(['itu', 'salto'], null), { unidade: 'itu', destino: '/atendimento' }, 'sem última')
})

test('admin da marca sem vínculo entra como antes', () => {
  assert.deepEqual(entradaAposLogin([], 'itu'), { unidade: 'itu', destino: '/funil' })
})
