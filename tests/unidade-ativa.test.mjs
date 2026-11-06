import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unidadeDaAba } from '../src/lib/unidade-ativa.ts'

test('a aba usa a unidade que pediu, se o usuário está nela', () => {
  assert.equal(unidadeDaAba('salto', 'itu', ['itu', 'salto']), 'salto')
})

test('sem pedido, ou pedido de unidade sem vínculo, fica a última usada', () => {
  assert.equal(unidadeDaAba(null, 'itu', ['itu', 'salto']), 'itu', 'aba nova')
  assert.equal(unidadeDaAba('comercial', 'itu', ['itu', 'salto']), 'itu', 'cookie de unidade sem vínculo')
  assert.equal(unidadeDaAba('salto', 'itu', []), 'itu', 'admin da marca sem vínculos')
})
