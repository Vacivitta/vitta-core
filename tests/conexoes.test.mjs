import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nomeDaInstancia, podeCriarConexao, podeGerenciarConexao } from '../src/lib/conexoes.ts'

const atendente = { userId: 'u1', ehMarca: false, ehGestor: false, membro: true }
const gestor = { userId: 'u2', ehMarca: false, ehGestor: true, membro: true }
const marca = { userId: 'u3', ehMarca: true, ehGestor: true, membro: false }
const deFora = { userId: 'u4', ehMarca: false, ehGestor: true, membro: false }

test('quem cria: pessoal qualquer membro; da unidade só gestor; de fora nunca', () => {
  assert.equal(podeCriarConexao(atendente, true), true)
  assert.equal(podeCriarConexao(atendente, false), false)
  assert.equal(podeCriarConexao(gestor, false), true)
  assert.equal(podeCriarConexao(marca, false), true)
  assert.equal(podeCriarConexao(marca, true), false, 'a marca não vira dona de número pessoal numa unidade em que não está')
  assert.equal(podeCriarConexao(deFora, false), false)
  assert.equal(podeCriarConexao(deFora, true), false)
})

test('quem gerencia: a dona da pessoal, o gestor da compartilhada, a marca todas; oficial nunca por aqui', () => {
  const pessoalDaAtendente = { tipo: 'qrcode', pessoal: true, dona_id: 'u1' }
  const compartilhada = { tipo: 'qrcode', pessoal: false, dona_id: null }
  assert.equal(podeGerenciarConexao(atendente, pessoalDaAtendente), true)
  assert.equal(podeGerenciarConexao(gestor, pessoalDaAtendente), false, 'gestor não mexe no número pessoal da colega')
  assert.equal(podeGerenciarConexao(marca, pessoalDaAtendente), true)
  assert.equal(podeGerenciarConexao(atendente, compartilhada), false)
  assert.equal(podeGerenciarConexao(gestor, compartilhada), true)
  assert.equal(podeGerenciarConexao(deFora, compartilhada), false)
  assert.equal(podeGerenciarConexao(marca, { tipo: 'oficial', pessoal: false, dona_id: null }), false)
})

test('nome da instância', () => {
  assert.equal(nomeDaInstancia('0A1B-2c'), 'vd-0a1b-2c')
  assert.equal(nomeDaInstancia('abc/../x'), 'vd-abc')
})
