import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  celulaSegura, decodificarArquivo, desfazerCelulaSegura, detectarSeparador, ehPlanilhaExcel, gerarCsv, lerCsv,
  linhaCsv, pareceTextoCorrompido, registroVazio,
} from '../src/lib/csv.ts'

test('lê campos com aspas, aspas escapadas e separador dentro de aspas', () => {
  const { registros, aspasAbertas } = lerCsv('nome;obs\n"Silva; Ana";"disse ""oi"""\n', ';')
  assert.deepEqual(registros, [['nome', 'obs'], ['Silva; Ana', 'disse "oi"']])
  assert.equal(aspasAbertas, false)
})

test('quebra de linha dentro de aspas fica no campo; CRLF, LF e CR separam registros', () => {
  const { registros } = lerCsv('a,b\r\n"linha 1\r\nlinha 2",x\ny,z\rw,k', ',')
  assert.deepEqual(registros, [['a', 'b'], ['linha 1\r\nlinha 2', 'x'], ['y', 'z'], ['w', 'k']])
})

test('quebra no fim não cria registro; separador no fim cria campo vazio; linha em branco é mantida', () => {
  assert.deepEqual(lerCsv('a;b\n', ';').registros, [['a', 'b']])
  assert.deepEqual(lerCsv('a;\n\nc;d', ';').registros, [['a', ''], [''], ['c', 'd']])
  assert.ok(registroVazio(['', '  ']))
  assert.ok(!registroVazio(['', 'x']))
})

test('aspas sem par são sinalizadas', () => {
  const r = lerCsv('a;b\n"aberto;x\n', ';')
  assert.equal(r.aspasAbertas, true)
})

test('BOM UTF-8 é removido na leitura e na detecção', () => {
  const { registros, separador } = lerCsv('﻿nome;telefone\nAna;31999998888')
  assert.equal(separador, ';')
  assert.deepEqual(registros[0], ['nome', 'telefone'])
})

test('detecta o separador fora de aspas; empate fica com ;', () => {
  assert.equal(detectarSeparador('nome;telefone;email\n'), ';')
  assert.equal(detectarSeparador('nome,telefone,email\n'), ',')
  assert.equal(detectarSeparador('"Silva, Ana";"31 9999"\n'), ';')
  assert.equal(detectarSeparador('nome\ttelefone\n'), '\t')
  assert.equal(detectarSeparador('nome\n'), ';')
})

test('decodifica UTF-8 (com BOM) e cai para Windows-1252 quando não é UTF-8', () => {
  const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('João;São Paulo')])
  assert.deepEqual(decodificarArquivo(utf8), { texto: 'João;São Paulo', codificacao: 'utf-8' })

  // "João;São" como o Excel BR grava (Windows-1252): ã = 0xE3, sozinho não é UTF-8 válido
  const latin = new Uint8Array([0x4a, 0x6f, 0xe3, 0x6f, 0x3b, 0x53, 0xe3, 0x6f, 0x20, 0x93, 0x78, 0x94])
  assert.deepEqual(decodificarArquivo(latin), { texto: 'João;São “x”', codificacao: 'windows-1252' })
})

test('reconhece texto já corrompido (UTF-8 lido como Latin-1)', () => {
  assert.ok(pareceTextoCorrompido('SÃ£o Paulo'))
  assert.ok(!pareceTextoCorrompido('São Paulo'))
})

test('reconhece .xlsx e .xls binários', () => {
  assert.ok(ehPlanilhaExcel(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])))
  assert.ok(ehPlanilhaExcel(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0])))
  assert.ok(!ehPlanilhaExcel(new TextEncoder().encode('nome;telefone')))
})

test('célula que vira fórmula ganha apóstrofo; a importação desfaz', () => {
  for (const perigosa of ['=1+1', '+5531999998888', '-2', '@SOMA(A1)', '\tx', '\rx']) {
    assert.equal(celulaSegura(perigosa), "'" + perigosa)
    assert.equal(desfazerCelulaSegura(celulaSegura(perigosa)), perigosa)
  }
  assert.equal(celulaSegura('Ana'), 'Ana')
  assert.equal(desfazerCelulaSegura("'texto"), "'texto")
})

test('gera CSV com BOM, ; e CRLF, entre aspas só quando precisa, e lê de volta igual', () => {
  const linhas = [['Nome', 'Obs'], ['Silva; Ana', 'disse "oi"\nfim'], ['=HYPERLINK("x")', '']]
  const csv = gerarCsv(linhas)
  assert.ok(csv.startsWith('﻿Nome;Obs\r\n'))
  assert.equal(linhaCsv(['a', 'b c']), 'a;b c')
  assert.equal(linhaCsv(['a,b'], ','), '"a,b"')
  const lido = lerCsv(csv).registros
  assert.deepEqual(lido, [['Nome', 'Obs'], ['Silva; Ana', 'disse "oi"\nfim'], ['\'=HYPERLINK("x")', '']])
})
