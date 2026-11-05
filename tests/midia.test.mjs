import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LIMITE_POR_TIPO, MIDIA_CORPO_MAXIMO, MIDIA_TAMANHO_MAXIMO, corpoGrandeDemais, erroTamanhoMidia, tipoMidia,
} from '../src/lib/whatsapp/midia.ts'

const MB = 1024 * 1024

test('tipo da mensagem pelo MIME', () => {
  assert.equal(tipoMidia('image/jpeg'), 'image')
  assert.equal(tipoMidia('video/mp4'), 'video')
  assert.equal(tipoMidia('audio/ogg'), 'audio')
  assert.equal(tipoMidia('application/pdf'), 'document')
  assert.equal(tipoMidia(''), 'document')
})

test('limite por tipo: o menor entre a Meta e 20 MB', () => {
  assert.deepEqual(LIMITE_POR_TIPO, { image: 5 * MB, video: 16 * MB, audio: 16 * MB, document: 20 * MB })
  assert.equal(MIDIA_TAMANHO_MAXIMO, 20 * MB)
})

test('arquivo no limite passa; um byte acima é recusado com mensagem do tipo', () => {
  assert.equal(erroTamanhoMidia('image/png', 5 * MB), null)
  assert.equal(erroTamanhoMidia('image/png', 5 * MB + 1),
    'Imagem maior que 5 MB: o WhatsApp não aceita. Reduza o arquivo antes de enviar.')
  assert.equal(erroTamanhoMidia('video/mp4', 16 * MB), null)
  assert.match(erroTamanhoMidia('video/mp4', 16 * MB + 1) ?? '', /^Vídeo maior que 16 MB/)
  assert.match(erroTamanhoMidia('audio/webm;codecs=opus', 17 * MB) ?? '', /^Áudio maior que 16 MB/)
  assert.equal(erroTamanhoMidia('application/pdf', 20 * MB), null)
  assert.match(erroTamanhoMidia('application/pdf', 20 * MB + 1) ?? '', /^Arquivo maior que 20 MB/)
  assert.match(erroTamanhoMidia('IMAGE/JPEG', 6 * MB) ?? '', /^Imagem/)
})

test('Content-Length acima do corpo aceito é recusado antes de ler', () => {
  assert.equal(corpoGrandeDemais(String(MIDIA_CORPO_MAXIMO)), false)
  assert.equal(corpoGrandeDemais(String(MIDIA_CORPO_MAXIMO + 1)), true)
  assert.equal(corpoGrandeDemais(String(30 * MB)), true)
  assert.equal(corpoGrandeDemais(null), false)
  assert.equal(corpoGrandeDemais('abc'), false)
})
