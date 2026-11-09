import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  camposDoFunil, chaveDoRotulo, comValor, entradaInicial, formatarValor, lerNumeroBR, opcoesValidas,
  valorDaEntrada, valorValido,
} from '../src/lib/campos.ts'

const casos = JSON.parse(readFileSync(new URL('./db/campos_casos.json', import.meta.url), 'utf8'))

function campo(tipo, extra = {}) {
  return {
    id: 'c', unit_id: 'u', funnel_id: null, chave: 'k', rotulo: 'Campo', ordem: 0, ativo: true, criado_em: '',
    tipo, opcoes: null, ...extra,
  }
}

test('chaveDoRotulo segue a tabela compartilhada com o SQL', () => {
  assert.ok(casos.chaves.length > 0)
  for (const { rotulo, chave, caso } of casos.chaves) {
    assert.equal(chaveDoRotulo(rotulo), chave, caso)
  }
})

test('opcoesValidas segue a tabela compartilhada com o SQL', () => {
  for (const { opcoes, valido, caso } of casos.opcoes) {
    assert.equal(opcoesValidas(opcoes), valido, caso)
  }
})

test('valorValido segue a tabela compartilhada com o SQL', () => {
  assert.ok(casos.valores.length > 20)
  for (const { tipo, opcoes, valor, valido, caso } of casos.valores) {
    assert.equal(valorValido(tipo, opcoes ?? null, valor), valido, `${caso}: ${JSON.stringify(valor)}`)
  }
})

test('lerNumeroBR entende o jeito brasileiro de digitar', () => {
  assert.equal(lerNumeroBR('1.234,56'), 1234.56)
  assert.equal(lerNumeroBR('R$ 150.000'), 150000)
  assert.equal(lerNumeroBR('1234.5'), 1234.5)
  assert.equal(lerNumeroBR('-3'), -3)
  assert.equal(lerNumeroBR(''), null)
  assert.equal(lerNumeroBR('doze'), null)
  assert.equal(lerNumeroBR('1,2,3'), null)
})

test('valorDaEntrada normaliza e valida pelo tipo', () => {
  assert.deepEqual(valorDaEntrada(campo('moeda'), 'R$ 1.500,555'), { ok: true, valor: 1500.56 })
  assert.deepEqual(valorDaEntrada(campo('numero'), '2,5'), { ok: true, valor: 2.5 })
  assert.deepEqual(valorDaEntrada(campo('numero'), 'abc'), { ok: false, erro: 'Digite um número' })
  assert.deepEqual(valorDaEntrada(campo('email'), ' Maria@Exemplo.COM '), { ok: true, valor: 'maria@exemplo.com' })
  assert.deepEqual(valorDaEntrada(campo('data'), '2021-02-29'), { ok: false, erro: 'Data inválida' })
  assert.deepEqual(valorDaEntrada(campo('texto'), '   '), { ok: true, valor: null })
  assert.deepEqual(valorDaEntrada(campo('sim_nao'), false), { ok: true, valor: false })
  const vacinas = campo('multipla', { opcoes: ['Gripe', 'HPV'] })
  assert.deepEqual(valorDaEntrada(vacinas, []), { ok: true, valor: null })
  assert.deepEqual(valorDaEntrada(vacinas, ['HPV']), { ok: true, valor: ['HPV'] })
  assert.equal(valorDaEntrada(vacinas, ['Dengue']).ok, false)
  assert.equal(valorDaEntrada(campo('selecao', { opcoes: ['A'] }), 'B').ok, false)
})

test('todo valor aceito por valorDaEntrada passa na regra do banco', () => {
  const entradas = [
    [campo('moeda'), '10,999'], [campo('numero'), '1.000.000'], [campo('telefone'), ' (31) 3333-4444 '],
    [campo('texto'), ' a '], [campo('data'), '2000-01-01'],
  ]
  for (const [c, e] of entradas) {
    const r = valorDaEntrada(c, e)
    assert.ok(r.ok && valorValido(c.tipo, c.opcoes, r.valor), `${c.tipo}: ${e}`)
  }
})

test('formatarValor e entradaInicial', () => {
  assert.equal(formatarValor(campo('moeda'), 150000.5).replace(/\s/g, ' '), 'R$ 150.000,50')
  assert.equal(formatarValor(campo('data'), '2020-02-29'), '29/02/2020')
  assert.equal(formatarValor(campo('sim_nao'), true), 'Sim')
  assert.equal(formatarValor(campo('multipla', { opcoes: ['A', 'B'] }), ['B', 'A']), 'B, A')
  assert.equal(formatarValor(campo('numero'), 1234.5), '1.234,5')
  assert.equal(formatarValor(campo('texto'), undefined), '')
  // Valor de tipo errado (gravado antes por outra regra) aparece como veio, sem quebrar
  assert.equal(formatarValor(campo('numero'), 'doze'), 'doze')
  assert.equal(entradaInicial(campo('moeda'), 10), '10,00')
  assert.deepEqual(entradaInicial(campo('multipla', { opcoes: ['A'] }), undefined), [])
})

test('camposDoFunil mostra os ativos da unidade e do funil do lead, em ordem', () => {
  const lista = [
    campo('texto', { id: '1', rotulo: 'B', ordem: 1 }),
    campo('texto', { id: '2', rotulo: 'A', ordem: 1 }),
    campo('texto', { id: '3', rotulo: 'Z', ordem: 0, funnel_id: 'f1' }),
    campo('texto', { id: '4', rotulo: 'Outro funil', ordem: 0, funnel_id: 'f2' }),
    campo('texto', { id: '5', rotulo: 'Desativado', ordem: 0, ativo: false }),
  ]
  assert.deepEqual(camposDoFunil(lista, 'f1').map(c => c.id), ['3', '2', '1'])
})

test('comValor troca ou tira a chave sem mexer nas outras', () => {
  assert.deepEqual(comValor({ a: 1, b: 'x' }, 'a', null), { b: 'x' })
  assert.deepEqual(comValor({ b: 'x' }, 'a', true), { b: 'x', a: true })
})

test('campos da pessoa e do negócio: cada valor vai para o seu lado', async () => {
  const { separarCampos } = await import('../src/lib/campos.ts')
  const defs = [{ chave: 'convenio', objeto: 'contato' }, { chave: 'vacina', objeto: 'negocio' }]
  assert.deepEqual(separarCampos(defs, { convenio: 'Unimed', vacina: 'Gripe', sem_definicao: 1 }), {
    negocio: { vacina: 'Gripe', sem_definicao: 1 },
    pessoa:  { convenio: 'Unimed' },
  })
  assert.deepEqual(separarCampos(defs, {}), { negocio: {}, pessoa: {} })
})
