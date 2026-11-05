import { test } from 'node:test'
import assert from 'node:assert/strict'
import { camposFiltraveis, opcoesDoFiltro, passaFiltroCampos, totalFiltrosCampos } from '../src/lib/funil/filtro-campos.ts'

const base = { unit_id: 'u', ordem: 0, ativo: true, criado_em: '' }
const CAMPOS = [
  { ...base, id: '1', funnel_id: null, chave: 'convenio', rotulo: 'Convênio', tipo: 'selecao', opcoes: ['Unimed', 'Bradesco'], ordem: 1 },
  { ...base, id: '2', funnel_id: null, chave: 'vacinas', rotulo: 'Vacinas', tipo: 'multipla', opcoes: ['Gripe', 'HPV', 'Dengue'], ordem: 2 },
  { ...base, id: '3', funnel_id: null, chave: 'gestante', rotulo: 'Gestante', tipo: 'sim_nao', opcoes: null, ordem: 3 },
  { ...base, id: '4', funnel_id: null, chave: 'obs', rotulo: 'Observação', tipo: 'texto', opcoes: null, ordem: 4 },
  { ...base, id: '5', funnel_id: 'f2', chave: 'porte', rotulo: 'Porte', tipo: 'selecao', opcoes: ['P', 'G'], ordem: 5 },
  { ...base, id: '6', funnel_id: null, chave: 'antigo', rotulo: 'Antigo', tipo: 'sim_nao', opcoes: null, ordem: 6, ativo: false },
]

test('só campos ativos de seleção, múltipla e sim/não da unidade ou do funil viram filtro', () => {
  assert.deepEqual(camposFiltraveis(CAMPOS, 'f1').map(c => c.chave), ['convenio', 'vacinas', 'gestante'])
  assert.deepEqual(camposFiltraveis(CAMPOS, 'f2').map(c => c.chave), ['convenio', 'vacinas', 'gestante', 'porte'])
  assert.deepEqual(opcoesDoFiltro(CAMPOS[2]), [{ id: 'sim', label: 'Sim' }, { id: 'nao', label: 'Não' }])
  assert.deepEqual(opcoesDoFiltro(CAMPOS[0]).map(o => o.id), ['Unimed', 'Bradesco'])
})

test('filtro por campo: OU dentro do campo, E entre campos', () => {
  const campos = camposFiltraveis(CAMPOS, 'f1')
  const lead = { convenio: 'Unimed', vacinas: ['HPV', 'Gripe'], gestante: false, obs: 'x' }
  assert.equal(passaFiltroCampos(lead, {}, campos), true)
  assert.equal(passaFiltroCampos(lead, { convenio: [] }, campos), true)
  assert.equal(passaFiltroCampos(lead, { convenio: ['Unimed', 'Bradesco'] }, campos), true)
  assert.equal(passaFiltroCampos(lead, { convenio: ['Bradesco'] }, campos), false)
  assert.equal(passaFiltroCampos(lead, { vacinas: ['Dengue', 'HPV'] }, campos), true)
  assert.equal(passaFiltroCampos(lead, { vacinas: ['Dengue'] }, campos), false)
  assert.equal(passaFiltroCampos(lead, { gestante: ['nao'] }, campos), true)
  assert.equal(passaFiltroCampos(lead, { gestante: ['sim'] }, campos), false)
  assert.equal(passaFiltroCampos(lead, { gestante: ['sim', 'nao'] }, campos), true)
  assert.equal(passaFiltroCampos(lead, { convenio: ['Unimed'], gestante: ['sim'] }, campos), false)
})

test('lead sem valor não passa; campo de outro funil é ignorado', () => {
  const campos = camposFiltraveis(CAMPOS, 'f1')
  assert.equal(passaFiltroCampos({}, { gestante: ['nao'] }, campos), false)
  assert.equal(passaFiltroCampos(undefined, { convenio: ['Unimed'] }, campos), false)
  // Valor gravado com outro tipo (ex.: antes de mudar o campo) não conta como marcado
  assert.equal(passaFiltroCampos({ gestante: 'nao' }, { gestante: ['nao'] }, campos), false)
  assert.equal(passaFiltroCampos({ vacinas: 'HPV' }, { vacinas: ['HPV'] }, campos), false)
  // 'porte' é do funil f2: no f1 o filtro que sobrou dele não esconde ninguém nem conta
  assert.equal(passaFiltroCampos({}, { porte: ['P'] }, campos), true)
  assert.equal(totalFiltrosCampos({ porte: ['P'], convenio: ['Unimed', 'Bradesco'] }, campos), 2)
})
