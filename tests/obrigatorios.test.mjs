import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CAMPOS_FIXOS, alternarObrigatorio, faltandoDoErro, faltandoNoLead, opcoesObrigatorios, rotuloObrigatorio,
} from '../src/lib/obrigatorios.ts'

const fixosDoBanco = JSON.parse(readFileSync(new URL('./db/obrigatorios_fixos.json', import.meta.url), 'utf8'))

function campo(chave, extra = {}) {
  return {
    id: chave, unit_id: 'u', funnel_id: null, chave, rotulo: chave.toUpperCase(), ordem: 0, ativo: true,
    criado_em: '', tipo: 'texto', opcoes: null, ...extra,
  }
}

test('campos fixos iguais aos de campos_fixos_lead() (tabela compartilhada com o SQL)', () => {
  assert.deepEqual(CAMPOS_FIXOS.map(({ chave, rotulo }) => ({ chave, rotulo })), fixosDoBanco)
  for (const f of CAMPOS_FIXOS) assert.equal(f.chave, `lead:${f.coluna}`)
})

test('faltandoDoErro lê o HINT do erro VC001', () => {
  const erro = {
    code: 'VC001',
    message: 'Para entrar na etapa "Orçamento enviado", preencha: E-mail, Vacinas',
    details: null,
    hint: '{"etapa_id": "e1", "faltando": ["lead:email", "vacinas"]}',
  }
  assert.deepEqual(faltandoDoErro(erro), { etapaId: 'e1', faltando: ['lead:email', 'vacinas'] })
})

test('faltandoDoErro ignora outros erros e HINT malformado', () => {
  assert.equal(faltandoDoErro(null), null)
  assert.equal(faltandoDoErro(new Error('x')), null)
  assert.equal(faltandoDoErro({ code: '23514', hint: '{"etapa_id": "e", "faltando": ["a"]}' }), null)
  assert.equal(faltandoDoErro({ code: 'VC001', hint: 'não é json' }), null)
  assert.equal(faltandoDoErro({ code: 'VC001', hint: '{"faltando": ["a"]}' }), null)
  assert.equal(faltandoDoErro({ code: 'VC001', hint: '{"etapa_id": "e", "faltando": []}' }), null)
  assert.equal(faltandoDoErro({ code: 'VC001', hint: null }), null)
})

test('faltandoNoLead segue a regra do trigger', () => {
  const defs = [
    campo('vacinas'),
    campo('antigo', { ativo: false }),
    campo('cnpj', { funnel_id: 'outro' }),
    campo('do_funil', { funnel_id: 'f1' }),
  ]
  const exigidos = ['lead:email', 'lead:responsavel_id', 'vacinas', 'antigo', 'cnpj', 'do_funil', 'sumiu', 'lead:x']
  const lead = { funnel_id: 'f1', email: '  ', responsavel_id: null, campos: {} }
  assert.deepEqual(faltandoNoLead(exigidos, lead, defs), ['lead:email', 'lead:responsavel_id', 'vacinas', 'do_funil'])

  const completo = { funnel_id: 'f1', email: 'a@b.co', responsavel_id: 'p1', campos: { vacinas: ['HPV'], do_funil: 'x' } }
  assert.deepEqual(faltandoNoLead(exigidos, completo, defs), [])
  assert.deepEqual(faltandoNoLead(['vacinas'], { funnel_id: 'f1', campos: { vacinas: false } }, defs), [],
    'false é valor (sim/não respondido)')
})

test('rotuloObrigatorio: fixo, personalizado ou a própria chave', () => {
  const defs = [campo('vacinas', { rotulo: 'Vacinas de interesse' })]
  assert.equal(rotuloObrigatorio('lead:email', defs), 'E-mail')
  assert.equal(rotuloObrigatorio('vacinas', defs), 'Vacinas de interesse')
  assert.equal(rotuloObrigatorio('sumiu', defs), 'sumiu')
})

test('opcoesObrigatorios: ativos do funil e desativados já escolhidos', () => {
  const defs = [
    campo('b', { ordem: 2 }),
    campo('a', { ordem: 1 }),
    campo('antigo', { ativo: false }),
    campo('antigo2', { ativo: false }),
    campo('outro_funil', { funnel_id: 'f2' }),
    campo('deste_funil', { funnel_id: 'f1', ordem: 3 }),
  ]
  const { fixos, personalizados } = opcoesObrigatorios(defs, 'f1', ['antigo'])
  assert.equal(fixos.length, CAMPOS_FIXOS.length)
  assert.deepEqual(personalizados.map(o => `${o.chave}${o.desativado ? '*' : ''}`), ['antigo*', 'a', 'b', 'deste_funil'])
})

test('alternarObrigatorio mantém a ordem de escolha', () => {
  assert.deepEqual(alternarObrigatorio(['a'], 'b'), ['a', 'b'])
  assert.deepEqual(alternarObrigatorio(['a', 'b'], 'a'), ['b'])
})
