import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANEXO_TIPOS, detectarTipoAnexo, formatarTamanho, nomeComExtensao, nomeParaCaminho, sanitizarNomeArquivo,
} from '../src/lib/anexos.ts'

const bytes = (...partes) => {
  const saida = []
  for (const p of partes) {
    if (typeof p === 'string') for (const c of p) saida.push(c.charCodeAt(0))
    else saida.push(...p)
  }
  return new Uint8Array([...saida, ...new Array(16).fill(0)])
}

test('detectarTipoAnexo reconhece os tipos permitidos pela assinatura', () => {
  assert.equal(detectarTipoAnexo(bytes('%PDF-1.7')), 'application/pdf')
  assert.equal(detectarTipoAnexo(bytes([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(detectarTipoAnexo(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png')
  assert.equal(detectarTipoAnexo(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 ')), 'image/webp')
  assert.equal(detectarTipoAnexo(bytes([0, 0, 0, 0x18], 'ftypheic')), 'image/heic')
  assert.equal(detectarTipoAnexo(bytes([0, 0, 0, 0x18], 'ftyphevc')), 'image/heic')
  assert.equal(detectarTipoAnexo(bytes([0, 0, 0, 0x18], 'ftypmif1')), 'image/heif')
})

test('detectarTipoAnexo recusa o resto, inclusive com extensão ou MIME "certos"', () => {
  assert.equal(detectarTipoAnexo(bytes('MZ')), null, 'executável Windows')
  assert.equal(detectarTipoAnexo(bytes('<html><body>')), null, 'HTML')
  assert.equal(detectarTipoAnexo(bytes('<svg xmlns=')), null, 'SVG')
  assert.equal(detectarTipoAnexo(bytes('PK', [3, 4])), null, 'zip/docx')
  assert.equal(detectarTipoAnexo(bytes('GIF89a')), null, 'GIF')
  assert.equal(detectarTipoAnexo(bytes([0, 0, 0, 0x18], 'ftypavif')), null, 'AVIF')
  assert.equal(detectarTipoAnexo(bytes([0, 0, 0, 0x18], 'ftypisom')), null, 'MP4')
  assert.equal(detectarTipoAnexo(bytes('RIFF', [1, 2, 3, 4], 'WAVEfmt ')), null, 'WAV')
  assert.equal(detectarTipoAnexo(bytes(' %PDF-1.7')), null, 'PDF fora do início')
  assert.equal(detectarTipoAnexo(new Uint8Array([0x25, 0x50])), null, 'curto demais')
  assert.equal(detectarTipoAnexo(new Uint8Array()), null, 'vazio')
})

test('todo tipo detectável está na lista do bucket', () => {
  for (const amostra of [bytes('%PDF-'), bytes([0xff, 0xd8, 0xff]), bytes('RIFF', [0, 0, 0, 0], 'WEBP'),
    bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bytes([0, 0, 0, 0], 'ftypheic'), bytes([0, 0, 0, 0], 'ftypmif1')]) {
    assert.ok(ANEXO_TIPOS.includes(detectarTipoAnexo(amostra)))
  }
})

test('sanitizarNomeArquivo tira pasta, controle e caracteres perigosos', () => {
  assert.equal(sanitizarNomeArquivo('Carteira de vacinação.pdf'), 'Carteira de vacinação.pdf')
  assert.equal(sanitizarNomeArquivo('../../etc/passwd'), 'passwd')
  assert.equal(sanitizarNomeArquivo('C:\\Users\\Ana\\pedido médico.jpg'), 'pedido médico.jpg')
  assert.equal(sanitizarNomeArquivo('a\u0000b\nc\r.pdf'), 'abc.pdf')
  assert.equal(sanitizarNomeArquivo('x"; filename=y.exe'), 'x filename=y.exe')
  assert.equal(sanitizarNomeArquivo('<script>.pdf'), 'script.pdf')
  assert.equal(sanitizarNomeArquivo('fatura\u202Efdp.exe'), 'faturafdp.exe', 'troca de direção do texto')
  assert.equal(sanitizarNomeArquivo('...oculto.pdf'), 'oculto.pdf')
  assert.equal(sanitizarNomeArquivo('  muitos    espaços  .pdf '), 'muitos espaços .pdf')
  assert.equal(sanitizarNomeArquivo(''), 'arquivo')
  assert.equal(sanitizarNomeArquivo('///'), 'arquivo')
  assert.equal(sanitizarNomeArquivo('..'), 'arquivo')
})

test('sanitizarNomeArquivo corta nomes longos mantendo a extensão', () => {
  const nome = sanitizarNomeArquivo('a'.repeat(300) + '.pdf')
  assert.equal(nome.length, 120)
  assert.ok(nome.endsWith('.pdf'))
})

test('nomeComExtensao acrescenta a extensão do tipo real', () => {
  assert.equal(nomeComExtensao('exame.pdf', 'application/pdf'), 'exame.pdf')
  assert.equal(nomeComExtensao('foto.JPEG', 'image/jpeg'), 'foto.JPEG')
  assert.equal(nomeComExtensao('exame.exe', 'application/pdf'), 'exame.exe.pdf')
  assert.equal(nomeComExtensao('foto.png', 'image/jpeg'), 'foto.png.jpg')
  assert.equal(nomeComExtensao('scan', 'image/heic'), 'scan.heic')
})

test('nomeParaCaminho gera chave ASCII segura para o storage', () => {
  assert.equal(nomeParaCaminho('Carteira de vacinação.pdf'), 'Carteira-de-vacinacao.pdf')
  assert.equal(nomeParaCaminho('pedido (1) — Dr. João.jpg'), 'pedido-1-Dr.-Joao.jpg')
  assert.equal(nomeParaCaminho('../x'), 'x')
  assert.equal(nomeParaCaminho('日本語'), 'arquivo')
  assert.ok(nomeParaCaminho('a'.repeat(200) + '.pdf').length <= 80)
  assert.match(nomeParaCaminho('qualquer coisa ?#%&*:;<>|"\'.pdf'), /^[A-Za-z0-9._-]+$/)
})

test('formatarTamanho', () => {
  assert.equal(formatarTamanho(500), '500 B')
  assert.equal(formatarTamanho(850 * 1024), '850 KB')
  assert.equal(formatarTamanho(1.4 * 1024 * 1024), '1,4 MB')
  assert.equal(formatarTamanho(20 * 1024 * 1024), '20 MB')
})
