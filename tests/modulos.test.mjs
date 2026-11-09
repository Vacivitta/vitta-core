import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MODULOS, modulosLigados, rotaNoMenu } from '../src/lib/modulos.ts'

test('sem exceção vale o padrão; a exceção gravada vence', () => {
  assert.deepEqual([...modulosLigados([])].sort(), ['campanhas', 'catalogo', 'orcamentos'])
  const ligados = modulosLigados([{ modulo: 'tickets', ativo: true }, { modulo: 'catalogo', ativo: false }])
  assert.equal(ligados.has('tickets'), true)
  assert.equal(ligados.has('catalogo'), false)
  assert.equal(ligados.has('orcamentos'), true)
})

test('o padrão do app é o mesmo da modulo_ativo() da migração 146', () => {
  const sql = readFileSync(new URL('../supabase/migrations/146_modulos.sql', import.meta.url), 'utf8')
  const doSql = sql.match(/p_modulo IN \(([^)]+)\)/)[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1)).sort()
  assert.deepEqual(MODULOS.filter(m => m.padrao).map(m => m.chave).sort(), doSql)
  const lista = sql.match(/modulo IN \(([^)]+)\)\),/)[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1)).sort()
  assert.deepEqual(MODULOS.map(m => m.chave).sort(), lista)
})

test('menu: rota de módulo desligado some; as outras ficam', () => {
  const ligados = modulosLigados([{ modulo: 'orcamentos', ativo: false }])
  assert.equal(rotaNoMenu('/orcamento', ligados), false)
  assert.equal(rotaNoMenu('/tickets', ligados), false)
  assert.equal(rotaNoMenu('/produtos', ligados), true)
  assert.equal(rotaNoMenu('/funil', ligados), true)
})
