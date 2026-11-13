import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PALETA_UNIDADES, corDaUnidade, precisaConfirmarResposta, rotuloRespondendoComo,
} from '../src/lib/unidades.ts'

test('a paleta do app é a mesma do preenchimento da migração 139', () => {
  const sql = readFileSync(new URL('../supabase/migrations/139_cor_da_unidade.sql', import.meta.url), 'utf8')
  const doSql = [...sql.match(/ARRAY\[([^\]]+)\]/)[1].matchAll(/'(#[0-9A-Fa-f]{6})'/g)].map(m => m[1])
  assert.deepEqual(doSql, [...PALETA_UNIDADES])
})

test('cor gravada vence a paleta; sem cor, a paleta pela posição, dando a volta', () => {
  assert.equal(corDaUnidade('#123456', 0), '#123456')
  assert.equal(corDaUnidade(null, 1), PALETA_UNIDADES[1])
  assert.equal(corDaUnidade(null, PALETA_UNIDADES.length), PALETA_UNIDADES[0])
})

test('barra Respondendo como: unidade e número, ou aviso sem número', () => {
  assert.equal(rotuloRespondendoComo({ nome: 'Itu', numero: '+55 11 4000-0000' }), 'Respondendo como Itu · +55 11 4000-0000')
  assert.equal(rotuloRespondendoComo({ nome: 'Salto', numero: null }), 'Respondendo como Salto · número não configurado')
})

test('barra Respondendo como: o número da conexão da conversa, com aviso no QR Code', () => {
  const itu = { nome: 'Itu', numero: '+55 11 4000-0000' }
  assert.equal(rotuloRespondendoComo(itu, { numero: '+55 11 4000-0000', tipo: 'oficial' }), 'Respondendo como Itu · +55 11 4000-0000')
  assert.equal(rotuloRespondendoComo(itu, { numero: '+5511988880001', tipo: 'qrcode' }), 'Respondendo como Itu · +5511988880001 · QR Code (não oficial)')
  assert.equal(rotuloRespondendoComo(itu, { numero: null, tipo: 'qrcode' }), 'Respondendo como Itu · +55 11 4000-0000 · QR Code (não oficial)')
})

test('confirma só ao responder conversa de outra unidade, uma vez por conversa', () => {
  const nenhuma = new Set()
  assert.equal(precisaConfirmarResposta('itu', 'itu', 'c1', nenhuma), false, 'mesma unidade não pede')
  assert.equal(precisaConfirmarResposta('salto', 'itu', 'c1', nenhuma), true, 'outra unidade pede')
  assert.equal(precisaConfirmarResposta('salto', 'itu', 'c1', new Set(['c1'])), false, 'já confirmada não pede de novo')
  assert.equal(precisaConfirmarResposta('salto', 'itu', 'c2', new Set(['c1'])), true, 'confirmação vale só para a conversa')
  assert.equal(precisaConfirmarResposta('salto', null, 'c1', nenhuma), true, 'sem unidade ativa, pede')
  assert.equal(precisaConfirmarResposta(null, 'itu', 'c1', nenhuma), false, 'conversa sem unidade não pede')
})
