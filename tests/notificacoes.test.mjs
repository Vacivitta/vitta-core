import { test } from 'node:test'
import assert from 'node:assert/strict'
import { destinoDaNotificacao, unidadeParaAbrir } from '../src/lib/notificacoes.ts'

test('orçamento vencendo ou vencido abre o orçamento; o resto abre o lead', () => {
  assert.equal(destinoDaNotificacao({ type: 'quote_expirado', quote_id: 'q', lead_id: 'l' }), '/orcamento?quote_id=q')
  assert.equal(destinoDaNotificacao({ type: 'quote_aceito', quote_id: 'q', lead_id: 'l' }), '/funil?lead=l')
  assert.equal(destinoDaNotificacao({ type: 'mention_note', quote_id: null, lead_id: 'l' }), '/funil?lead=l&tab=Anotações')
  assert.equal(destinoDaNotificacao({ type: 'chat_mention', quote_id: null, lead_id: null }), null)
})

test('ticket atribuído abre o ticket, mesmo com lead', () => {
  assert.equal(destinoDaNotificacao({ type: 'ticket_atribuido', quote_id: null, lead_id: 'l', ticket_id: 't' }), '/tickets?ticket=t')
})

test('WhatsApp desconectado (QR Code) abre a tela de conexões para ler o QR de novo', () => {
  assert.equal(destinoDaNotificacao({ type: 'conexao_caiu', quote_id: null, lead_id: null }), '/configuracoes/conexoes')
})

test('troca para a unidade da notificação só quando é outra e o usuário está nela', () => {
  assert.equal(unidadeParaAbrir('itu', 'itu', ['itu', 'salto']), null, 'mesma unidade')
  assert.equal(unidadeParaAbrir('salto', 'itu', ['itu', 'salto']), 'salto', 'outra unidade vinculada')
  assert.equal(unidadeParaAbrir('comercial', 'itu', ['itu', 'salto']), null, 'sem vínculo não troca')
})
