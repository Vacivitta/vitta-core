import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerCsv } from '../src/lib/csv.ts'
import {
  classificarErroDeLinha, lerDataBR, lerPedidoImportacao, prepararImportacao, separarExistentes, sugerirMapeamento, validarMapeamento,
  valorDaPlanilha,
} from '../src/lib/importacao.ts'

function campo(chave, tipo, extra = {}) {
  return {
    id: chave, unit_id: 'u', funnel_id: null, chave, rotulo: chave, ordem: 0, ativo: true, criado_em: '',
    tipo, opcoes: null, ...extra,
  }
}

const CAMPOS = [
  campo('valor_estimado', 'moeda', { rotulo: 'Valor estimado' }),
  campo('vacina', 'selecao', { rotulo: 'Vacina', opcoes: ['Gripe', 'Hepatite B'] }),
  campo('aceita_contato', 'sim_nao', { rotulo: 'Aceita contato' }),
  campo('data_evento', 'data', { rotulo: 'Data do evento' }),
]
const TAGS = [{ id: 't1', name: 'Evento 2026' }, { id: 't2', name: 'VIP' }]
const CTX = { campos: CAMPOS, tags: TAGS, origemPadrao: 'Evento', funnelId: 'f1', exigidos: [], responsavelId: null }

test('sugere o mapeamento pelo cabeçalho, com acentos e sinônimos, sem repetir destino', () => {
  const m = sugerirMapeamento(
    ['Nome completo', 'WhatsApp', 'E-mail', 'Celular 2', 'Valor estimado', 'Etiquetas', 'Data de Nascimento', 'Coluna X'],
    CAMPOS,
  )
  assert.deepEqual(m, [
    'nome', 'telefone', 'email', 'ignorar', 'campo:valor_estimado', 'tags', 'data_nascimento', 'ignorar',
  ])
})

test('mapeamento exige nome e telefone, sem destino repetido nem campo de outro funil', () => {
  assert.equal(validarMapeamento(['nome', 'telefone'], CAMPOS), null)
  assert.match(validarMapeamento(['nome'], CAMPOS), /telefone/)
  assert.match(validarMapeamento(['telefone', 'ignorar'], CAMPOS), /nome/)
  assert.match(validarMapeamento(['nome', 'telefone', 'email', 'email'], CAMPOS), /Duas colunas/)
  assert.match(validarMapeamento(['nome', 'telefone', 'campo:outro'], CAMPOS), /não vale/)
})

test('datas dd/mm/aaaa e ISO; data impossível é recusada', () => {
  assert.equal(lerDataBR('31/12/1990'), '1990-12-31')
  assert.equal(lerDataBR('1/2/1990'), '1990-02-01')
  assert.equal(lerDataBR('1990-12-31'), '1990-12-31')
  assert.equal(lerDataBR('31/02/1990'), null)
  assert.equal(lerDataBR('12/1990'), null)
})

test('valor da planilha usa as regras de src/lib/campos.ts', () => {
  const [moeda, selecao, simNao, data] = CAMPOS
  assert.deepEqual(valorDaPlanilha(moeda, 'R$ 1.234,56'), { ok: true, valor: 1234.56 })
  assert.deepEqual(valorDaPlanilha(selecao, 'hepatite b'), { ok: true, valor: 'Hepatite B' })
  assert.equal(valorDaPlanilha(selecao, 'Febre amarela').ok, false)
  assert.deepEqual(valorDaPlanilha(simNao, 'Não'), { ok: true, valor: false })
  assert.equal(valorDaPlanilha(simNao, 'talvez').ok, false)
  assert.deepEqual(valorDaPlanilha(data, '05/03/2026'), { ok: true, valor: '2026-03-05' })
  assert.deepEqual(valorDaPlanilha(moeda, '  '), { ok: true, valor: null })
  const multipla = campo('doses', 'multipla', { opcoes: ['1ª', '2ª', 'Reforço'] })
  assert.deepEqual(valorDaPlanilha(multipla, 'reforço, 1ª; Reforço'), { ok: true, valor: ['Reforço', '1ª'] })
})

const MAPA = ['nome', 'telefone', 'email', 'campo:valor_estimado', 'tags', 'origem']

function preparar(csv, mapa = MAPA) {
  return prepararImportacao(lerCsv(csv).registros, mapa, CTX)
}

test('telefone repetido com formatos diferentes no mesmo arquivo: só a primeira linha entra', () => {
  const r = preparar([
    'nome;telefone;email;valor;tags;origem',
    'Ana;(31) 99667-4494;;;;',
    'Ana de novo;+55 31 99667-4494;;;;',
    'Ana sem nove;31 9667-4494;;;;',
    'Bruno;34 3333-4444;;;;',
  ].join('\n'))
  assert.deepEqual(r.linhas.map(l => [l.linha, l.telefoneNorm]), [[2, '5531996674494'], [5, '553433334444']])
  assert.deepEqual(r.repetidas, [
    { linha: 3, telefone: '(31) 99667-4494', primeiraLinha: 2 },
    { linha: 4, telefone: '(31) 99667-4494', primeiraLinha: 2 },
  ])
})

test('linhas inválidas trazem o motivo; campo personalizado inválido invalida a linha', () => {
  const r = preparar([
    'nome;telefone;email;valor;tags;origem',
    ';31999998888;;;;',
    'Carla;123;;;;',
    'Davi;;;;;',
    'Eva;31988887777;eva@;;;',
    'Fábio;31977776666;;dez reais;;',
    'Gil;31966665555;GIL@X.COM;R$ 10,50;vip, Evento 2026, Inexistente;Instagram',
    ';;;;;',
  ].join('\n'))
  assert.deepEqual(r.invalidas, [
    { linha: 2, motivo: 'Sem nome' },
    { linha: 3, motivo: 'Telefone inválido: 123' },
    { linha: 4, motivo: 'Sem telefone' },
    { linha: 5, motivo: 'E-mail inválido: eva@' },
    { linha: 6, motivo: 'Valor estimado: Digite um número' },
  ])
  assert.equal(r.linhas.length, 1)
  const gil = r.linhas[0]
  assert.equal(gil.linha, 7)
  assert.equal(gil.dados.email, 'gil@x.com')
  assert.equal(gil.dados.telefone, '(31) 96666-5555')
  assert.equal(gil.dados.origem, 'Instagram')
  assert.deepEqual(gil.campos, { valor_estimado: 10.5 })
  assert.deepEqual(gil.tagIds.sort(), ['t1', 't2'])
  assert.deepEqual(r.tagsDesconhecidas, ['Inexistente'])
})

test('origem padrão vale quando a linha não tem; apóstrofo anti-fórmula de export é desfeito', () => {
  const r = preparar("nome;telefone;email;valor;tags;origem\nHelena;'+12125551234;;;;\n")
  assert.equal(r.linhas[0].telefoneNorm, '12125551234')
  assert.equal(r.linhas[0].dados.origem, 'Evento')
})

test('telefones que já existem na unidade são separados (pulados, não atualizados)', () => {
  const r = preparar('nome;telefone;email;valor;tags;origem\nAna;31996674494;;;;\nBia;31955554444;;;;\n')
  const { novas, existentes } = separarExistentes(r.linhas, new Set(['5531996674494']))
  assert.deepEqual(novas.map(l => l.linha), [3])
  assert.deepEqual(existentes, [{ linha: 2, telefone: '(31) 99667-4494' }])
})

test('pedido de importação valida o formato do corpo', () => {
  const ok = {
    texto: 'nome;telefone\nAna;31999998888', mapeamento: ['nome', 'telefone'],
    funnel_id: '00000000-0000-4000-8000-000000000001', stage_id: '00000000-0000-4000-8000-000000000002',
    responsavel_id: null, origem_padrao: '  ', clientes: false,
  }
  const r = lerPedidoImportacao(ok)
  assert.ok(r.ok)
  assert.equal(r.pedido.origem_padrao, null)
  assert.equal(lerPedidoImportacao({ ...ok, mapeamento: ['senha'] }).ok, false)
  assert.equal(lerPedidoImportacao({ ...ok, stage_id: 'x' }).ok, false)
  assert.equal(lerPedidoImportacao({ ...ok, clientes: 'sim' }).ok, false)
  assert.equal(lerPedidoImportacao({ ...ok, texto: 'x'.repeat(5 * 1024 * 1024 + 1) }).ok, false)
})

test('etapa com campos obrigatórios (130): linha sem eles é inválida antes de ir ao banco', () => {
  const ctx = { ...CTX, exigidos: ['lead:email', 'valor_estimado', 'lead:responsavel_id'] }
  const registros = lerCsv([
    'nome;telefone;email;valor;tags;origem',
    'Ana;31996674494;ana@ex.com;1500;;',
    'Bia;31955554444;;1500;;',
    'Caio;31944443333;caio@ex.com;  ;;',
  ].join('\n')).registros

  const sem = prepararImportacao(registros, MAPA, ctx)
  assert.deepEqual(sem.linhas, [])
  assert.deepEqual(sem.invalidas.map(i => [i.linha, i.motivo]), [
    [2, 'Faltando para entrar na etapa: Responsável'],
    [3, 'Faltando para entrar na etapa: E-mail, Responsável'],
    [4, 'Faltando para entrar na etapa: Valor estimado, Responsável'],
  ])

  const com = prepararImportacao(registros, MAPA, { ...ctx, responsavelId: 'u1' })
  assert.deepEqual(com.linhas.map(l => l.linha), [2])
  assert.deepEqual(com.invalidas.map(i => [i.linha, i.motivo]), [
    [3, 'Faltando para entrar na etapa: E-mail'],
    [4, 'Faltando para entrar na etapa: Valor estimado'],
  ])
})

test('obrigatórios: origem padrão conta, CPF nunca vem da planilha e campo de outro funil não conta', () => {
  const registros = lerCsv('nome;telefone;email;valor;tags;origem\nAna;31996674494;;;;\n').registros
  const com = exigidos => prepararImportacao(registros, MAPA, { ...CTX, exigidos })
  assert.equal(com(['lead:origem']).linhas.length, 1, 'a origem padrão preenche a exigência')
  assert.deepEqual(com(['lead:cpf']).invalidas.map(i => i.motivo), ['Faltando para entrar na etapa: CPF'])
  const outroFunil = [...CAMPOS, campo('so_f2', 'texto', { funnel_id: 'f2' })]
  assert.equal(prepararImportacao(registros, MAPA, { ...CTX, campos: outroFunil, exigidos: ['so_f2'] }).linhas.length, 1)
})

test('erro do banco na linha: 23505 já existe, 22/23/VC001 inválida, o resto interrompe', () => {
  assert.equal(classificarErroDeLinha({ code: '23505' }), 'existe')
  assert.equal(classificarErroDeLinha({ code: '23514' }), 'invalida')
  assert.equal(classificarErroDeLinha({ code: '22P02' }), 'invalida')
  assert.equal(classificarErroDeLinha({ code: 'VC001' }), 'invalida')
  assert.equal(classificarErroDeLinha({ code: '42501' }), 'fatal')
  assert.equal(classificarErroDeLinha({ code: '57014' }), 'fatal')
  assert.equal(classificarErroDeLinha(null), 'fatal')
})
