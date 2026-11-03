import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  avisoTelefone, formatarTelefone, normalizarTelefone, normalizarWaPhone, telefoneParaGravar, variantesTelefone,
} from '../src/lib/telefone.ts'

const casos = JSON.parse(readFileSync(new URL('./db/telefone_casos.json', import.meta.url), 'utf8'))

test('normalizarTelefone segue a tabela compartilhada com o SQL', () => {
  assert.ok(casos.length > 0)
  for (const { entrada, esperado, caso } of casos) {
    assert.equal(normalizarTelefone(entrada), esperado, `${caso}: ${JSON.stringify(entrada)}`)
  }
})

test('forma canônica volta igual pela exibição e pelo wa_phone', () => {
  for (const { esperado } of casos) {
    if (esperado === null) continue
    assert.equal(normalizarTelefone(formatarTelefone(esperado)), esperado, formatarTelefone(esperado))
    assert.equal(normalizarWaPhone(esperado), esperado, esperado)
  }
})

test('formatarTelefone', () => {
  assert.equal(formatarTelefone('5531996674494'), '(31) 99667-4494')
  assert.equal(formatarTelefone('553133334444'), '(31) 3333-4444')
  assert.equal(formatarTelefone('12125551234'), '+12125551234')
})

test('variantesTelefone: celular com e sem o 9', () => {
  assert.deepEqual(variantesTelefone('5531996674494'), ['5531996674494', '553196674494'])
  assert.deepEqual(variantesTelefone('553133334444'), ['553133334444'])
  assert.deepEqual(variantesTelefone('12125551234'), ['12125551234'])
})

test('normalizarWaPhone lê o wa_id da Meta com DDI', () => {
  assert.equal(normalizarWaPhone('553196674494'), '5531996674494')
  assert.equal(normalizarWaPhone('12125551234'), '12125551234')
})

test('avisoTelefone', () => {
  assert.equal(avisoTelefone(''), null)
  assert.equal(avisoTelefone('(31) 99667-4494'), null)
  assert.equal(avisoTelefone('+1 212 555 1234'), null)
  assert.match(avisoTelefone('31 8888-7777') ?? '', /sem o 9° dígito.*\(31\) 98888-7777/)
  assert.match(avisoTelefone('9966') ?? '', /inválido/)
})

test('telefoneParaGravar', () => {
  assert.equal(telefoneParaGravar('31996674494'), '(31) 99667-4494')
  assert.equal(telefoneParaGravar('  '), null)
  assert.equal(telefoneParaGravar('ramal 12'), 'ramal 12')
})
