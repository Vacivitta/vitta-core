import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { interpretarMensagemQr, previaDaMensagem, statusDaConexao, webhookEvolutionAutorizado } from '../src/lib/whatsapp/evolution-webhook.ts'

const SEGREDO = 'segredo-ficticio'
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
function jwt(carga, { segredo = SEGREDO, alg = 'HS256' } = {}) {
  const cab = b64({ alg, typ: 'JWT' })
  const corpo = b64(carga)
  const assinatura = createHmac('sha256', segredo).update(`${cab}.${corpo}`).digest('base64url')
  return `Bearer ${cab}.${corpo}.${assinatura}`
}
const AGORA = 1_800_000_000

test('webhook da Evolution: aceita só o JWT HS256 válido, assinado com o segredo', () => {
  const valido = jwt({ iat: AGORA, exp: AGORA + 600, app: 'evolution', action: 'webhook' })
  assert.equal(webhookEvolutionAutorizado(valido, SEGREDO, AGORA), true)
  assert.equal(webhookEvolutionAutorizado(valido, 'outro-segredo', AGORA), false, 'segredo errado')
  assert.equal(webhookEvolutionAutorizado(jwt({ iat: AGORA, exp: AGORA + 600 }, { segredo: 'x' }), SEGREDO, AGORA), false, 'assinado com outra chave')
  assert.equal(webhookEvolutionAutorizado(jwt({ iat: AGORA - 900, exp: AGORA - 300 }), SEGREDO, AGORA), false, 'vencido')
  assert.equal(webhookEvolutionAutorizado(jwt({ iat: AGORA + 3600, exp: AGORA + 4200 }), SEGREDO, AGORA), false, 'emitido no futuro')
  assert.equal(webhookEvolutionAutorizado(jwt({ iat: AGORA }), SEGREDO, AGORA), false, 'sem exp')
  assert.equal(webhookEvolutionAutorizado(jwt({ iat: AGORA, exp: AGORA + 600 }, { alg: 'none' }), SEGREDO, AGORA), false, 'outro algoritmo')
  assert.equal(webhookEvolutionAutorizado(null, SEGREDO, AGORA), false)
  assert.equal(webhookEvolutionAutorizado('Bearer abc', SEGREDO, AGORA), false)
  assert.equal(webhookEvolutionAutorizado(valido, undefined, AGORA), false, 'sem segredo configurado, recusa tudo')
  const [cab, corpo] = valido.slice(7).split('.')
  const adulterado = `Bearer ${cab}.${b64({ iat: AGORA, exp: AGORA + 99999 })}.${valido.split('.')[2]}`
  assert.equal(webhookEvolutionAutorizado(adulterado, SEGREDO, AGORA), false, 'carga trocada')
  assert.ok(corpo)
})

test('estado da sessão vira status da conexão', () => {
  assert.equal(statusDaConexao('open'), 'conectada')
  assert.equal(statusDaConexao('close'), 'desconectada')
  assert.equal(statusDaConexao('refused'), 'desconectada')
  assert.equal(statusDaConexao('connecting'), null)
  assert.equal(statusDaConexao(undefined), null)
})

test('mensagem de texto recebida e enviada pelo próprio celular', () => {
  const recebida = interpretarMensagemQr({
    key: { remoteJid: '5511900000099@s.whatsapp.net', fromMe: false, id: 'ABC1' },
    pushName: ' Licenciado ',
    messageType: 'conversation',
    message: { conversation: 'oi' },
  })
  assert.deepEqual(recebida, { telefone: '5511900000099', grupo: false, autor: null, deMim: false, id: 'ABC1', nome: 'Licenciado', tipo: 'text', texto: 'oi', midia: null })
  const doCelular = interpretarMensagemQr({
    key: { remoteJid: '5511900000099@s.whatsapp.net', fromMe: true, id: 'ABC2' },
    messageType: 'extendedTextMessage',
    message: { extendedTextMessage: { text: 'respondi pelo celular' } },
  })
  assert.equal(doCelular.deMim, true)
  assert.equal(doCelular.texto, 'respondi pelo celular')
  assert.equal(doCelular.nome, null)
})

test('mídia traz o base64, o tipo e a legenda; documento com legenda também', () => {
  const imagem = interpretarMensagemQr({
    key: { remoteJid: '5511900000099@s.whatsapp.net', id: 'IMG1' },
    messageType: 'imageMessage',
    message: { imageMessage: { mimetype: 'image/jpeg', caption: 'vacina' }, base64: 'AAAA' },
  })
  assert.deepEqual(imagem.midia, { base64: 'AAAA', mimetype: 'image/jpeg', nomeArquivo: null })
  assert.equal(imagem.texto, 'vacina')
  assert.equal(previaDaMensagem(imagem), '📷 Imagem: vacina')
  const audio = interpretarMensagemQr({
    key: { remoteJid: '5511900000099@s.whatsapp.net', id: 'AUD1' },
    messageType: 'audioMessage',
    message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' }, base64: 'BBBB' },
  })
  assert.equal(audio.midia.mimetype, 'audio/ogg')
  assert.equal(previaDaMensagem(audio), '🎤 Áudio')
  const doc = interpretarMensagemQr({
    key: { remoteJid: '5511900000099@s.whatsapp.net', id: 'DOC1' },
    messageType: 'documentWithCaptionMessage',
    message: { documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'application/pdf', fileName: 'contrato.pdf', caption: 'segue' } } }, base64: 'CCCC' },
  })
  assert.deepEqual(doc.midia, { base64: 'CCCC', mimetype: 'application/pdf', nomeArquivo: 'contrato.pdf' })
  assert.equal(doc.texto, 'segue')
  const semBase64 = interpretarMensagemQr({
    key: { remoteJid: '5511900000099@s.whatsapp.net', id: 'IMG2' },
    messageType: 'imageMessage',
    message: { imageMessage: { mimetype: 'image/jpeg' } },
  })
  assert.equal(semBase64.midia, null)
})

test('mensagem de grupo: id do grupo, autor pelo participant ou pelo participantAlt quando é LID', () => {
  const base = { messageType: 'conversation', message: { conversation: 'bom dia' }, pushName: 'Licenciado Itu' }
  const doGrupo = interpretarMensagemQr({ ...base, key: { remoteJid: '120363000000000145@g.us', id: 'G1', participant: '5511900000777@s.whatsapp.net' } })
  assert.equal(doGrupo.grupo, true)
  assert.equal(doGrupo.telefone, '120363000000000145')
  assert.deepEqual(doGrupo.autor, { telefone: '5511900000777', nome: 'Licenciado Itu' })
  assert.equal(doGrupo.nome, null, 'o nome do autor não vira nome da conversa')
  assert.equal(previaDaMensagem(doGrupo), 'Licenciado Itu: bom dia')
  const porLid = interpretarMensagemQr({ ...base, key: { remoteJid: '120363000000000145@g.us', id: 'G2', participant: '987654321@lid', participantAlt: '5511900000888@s.whatsapp.net' } })
  assert.equal(porLid.autor.telefone, '5511900000888')
  const semNumero = interpretarMensagemQr({ ...base, key: { remoteJid: '120363000000000145@g.us', id: 'G3', participant: '987654321@lid' } })
  assert.deepEqual(semNumero.autor, { telefone: null, nome: 'Licenciado Itu' })
  const minha = interpretarMensagemQr({ ...base, key: { remoteJid: '120363000000000145@g.us', id: 'G4', fromMe: true } })
  assert.equal(minha.autor, null, 'o que a conexão mandou não tem autor de fora')
  assert.equal(previaDaMensagem(minha), 'bom dia')
})

test('ignora status, LID sem número, reação e texto vazio', () => {
  const base = { messageType: 'conversation', message: { conversation: 'oi' } }
  assert.equal(interpretarMensagemQr({ ...base, key: { remoteJid: 'status@broadcast', id: 'S1' } }), null)
  assert.equal(interpretarMensagemQr({ ...base, key: { remoteJid: '123456789@lid', id: 'L1' } }), null)
  assert.equal(interpretarMensagemQr({ key: { remoteJid: '5511900000099@s.whatsapp.net', id: 'R1' }, messageType: 'reactionMessage', message: {} }), null)
  assert.equal(interpretarMensagemQr({ key: { remoteJid: '5511900000099@s.whatsapp.net', id: 'T1' }, messageType: 'conversation', message: {} }), null)
  assert.equal(interpretarMensagemQr({ key: { remoteJid: '5511900000099@s.whatsapp.net' }, ...base }), null, 'sem id')
  assert.equal(interpretarMensagemQr(null), null)
})
