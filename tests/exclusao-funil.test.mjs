import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mensagemRecusaPorReferencia, mensagemUsadaPorAutomacao } from '../src/lib/funil/exclusao.ts'

test('etapa ou funil sem automação: sem mensagem', () => {
  assert.equal(mensagemUsadaPorAutomacao('etapa', []), null)
  assert.equal(mensagemUsadaPorAutomacao('funil', []), null)
})

test('nomeia a automação que usa a etapa ou o funil como filtro', () => {
  assert.equal(
    mensagemUsadaPorAutomacao('etapa', ['Parado 5 dias']),
    'Esta etapa é usada como filtro pela automação "Parado 5 dias". '
      + 'Exclua ou edite essa automação em Configurações > Automações antes de excluir.',
  )
  assert.equal(
    mensagemUsadaPorAutomacao('funil', ['B', 'A', 'B', '  ']),
    'Este funil é usado como filtro pelas automações "B", "A", "sem nome". '
      + 'Exclua ou edite essas automações em Configurações > Automações antes de excluir.',
  )
})

test('recusa do banco por referência (23503) vira mensagem; outros erros não', () => {
  assert.match(mensagemRecusaPorReferencia('funil', { code: '23503' }) ?? '', /^Este funil ainda está em uso/)
  assert.match(mensagemRecusaPorReferencia('etapa', { code: '23503' }) ?? '', /^Esta etapa ainda está em uso/)
  assert.equal(mensagemRecusaPorReferencia('etapa', { code: '42501' }), null)
  assert.equal(mensagemRecusaPorReferencia('etapa', null), null)
})
