import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  comPessoaDoContato, dependentesDoContato, nomeDaPessoaDaConversa, nomesDosDependentes, ordenarNegocios,
  separarPessoaENegocio,
} from '../src/lib/contatos.ts'

const contato = (id, extra = {}) => ({
  id, unit_id: 'u1', nome: 'Ana', sobrenome: 'Lima', telefone: '(11) 90000-0001', telefone_norm: '5511900000001',
  email: 'ana@teste.invalid', cpf: null, data_nascimento: null, profissao: 'Médica', cidade: 'Itu', estado: 'SP',
  pais: 'Brasil', instagram: null, site: null, observacoes: 'prefere manhã', cliente: true,
  wa_optin_at: '2026-11-01T10:00:00Z', wa_optout_at: null, responsavel_id: null, relacao: null,
  criado_em: '2026-11-01T10:00:00Z', atualizado_em: '2026-11-01T10:00:00Z', ...extra,
})

test('a pessoa vem do contato; o que é do negócio fica no lead', () => {
  const lead = { id: 'l1', nome: 'Antigo', sobrenome: null, telefone: null, email: null, cpf: null, data_nascimento: null,
    profissao: null, cidade: null, estado: null, pais: null, instagram: null, site: null, observacoes_cli: null,
    wa_optin_at: null, wa_optout_at: '2026-10-01T00:00:00Z', status: 'aberto', funnel_id: 'f1', is_converted: false }
  const r = comPessoaDoContato(lead, contato('l1'))
  assert.equal(r.nome, 'Ana')
  assert.equal(r.observacoes_cli, 'prefere manhã')
  assert.equal(r.wa_optout_at, null, 'o opt-out é da pessoa: vale o do contato')
  assert.equal(r.status, 'aberto')
  assert.equal(r.funnel_id, 'f1')
  assert.equal(r.is_converted, false, 'cliente ainda não substitui is_converted (5c)')
})

test('sem contato carregado, fica o lead como veio', () => {
  const lead = { id: 'l1', nome: 'Bia', sobrenome: null }
  assert.equal(comPessoaDoContato(lead, null), lead)
})

test('dependentes: só os do contato, na ordem de criação, no formato de lead_contacts', () => {
  const lista = [
    contato('l1'),
    contato('d2', { nome: 'Caio', responsavel_id: 'l1', relacao: 'filho', criado_em: '2026-11-03T00:00:00Z', observacoes: 'alergia' }),
    contato('d1', { nome: 'Duda', responsavel_id: 'l1', relacao: 'filha', criado_em: '2026-11-02T00:00:00Z' }),
    contato('d3', { nome: 'De outro', responsavel_id: 'l9', relacao: 'filho' }),
    contato('d4', { nome: 'Relação nova', responsavel_id: 'l1', relacao: 'sobrinho', criado_em: '2026-11-04T00:00:00Z' }),
  ]
  const deps = dependentesDoContato(lista, 'l1', 'lead-1')
  assert.deepEqual(deps.map(d => d.id), ['d1', 'd2', 'd4'])
  assert.equal(deps[1].lead_id, 'lead-1')
  assert.equal(deps[1].observacao, 'alergia')
  assert.equal(deps[1].relacao, 'filho')
  assert.equal(deps[2].relacao, 'outro', 'relação fora da lista vira "outro"')
})

test('nome da conversa: contato antes do lead; nenhum dos dois dá null', () => {
  assert.equal(nomeDaPessoaDaConversa({ contato: { nome: 'Ana', sobrenome: 'Lima' }, lead: { nome: 'Velho', sobrenome: null } }), 'Ana Lima')
  assert.equal(nomeDaPessoaDaConversa({ contato: null, lead: { nome: 'Lead', sobrenome: null } }), 'Lead')
  assert.equal(nomeDaPessoaDaConversa({}), null)
})

test('nomes dos dependentes agrupados pelo responsável', () => {
  assert.deepEqual(nomesDosDependentes([
    { responsavel_id: 'a', nome: 'Caio' }, { responsavel_id: 'a', nome: 'Duda' }, { responsavel_id: null, nome: 'x' },
    { responsavel_id: 'b', nome: 'Eva' },
  ]), { a: 'Caio Duda', b: 'Eva' })
})

test('negócios: abertos primeiro, arquivados no fim, mais recente antes', () => {
  const n = (id, status, created_at, arquivado = false) => ({ id, status, created_at, arquivado })
  const lista = [
    n('ganho-velho', 'ganho', '2026-01-01'), n('aberto-velho', 'aberto', '2026-02-01'),
    n('arquivado', 'aberto', '2026-11-01', true), n('aberto-novo', 'aberto', '2026-10-01'),
    n('perdido-novo', 'perdido', '2026-09-01'),
  ]
  assert.deepEqual(ordenarNegocios(lista).map(x => x.id), ['aberto-novo', 'aberto-velho', 'perdido-novo', 'ganho-velho', 'arquivado'])
})

test('formulário do negócio: pessoa para o contato, o resto para o lead', () => {
  const { pessoa, negocio } = separarPessoaENegocio({
    nome: 'Ana', telefone: '5511900000001', email: '', observacoes_cli: 'manhã',
    origem: 'Instagram', funnel_id: 'f1', stage_id: 'e1', responsavel_id: null,
  })
  assert.deepEqual(pessoa, { nome: 'Ana', telefone: '5511900000001', email: '', observacoes: 'manhã' })
  assert.deepEqual(negocio, { origem: 'Instagram', funnel_id: 'f1', stage_id: 'e1', responsavel_id: null })
})
