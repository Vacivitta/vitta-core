import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cnpjParaGravar, colunasDoKanban, formatarCnpj, ordenarTickets } from '../src/lib/tickets.ts'

test('CNPJ: grava só dígitos, aceita máscara, recusa tamanho errado, vazio vira null', () => {
  assert.deepEqual(cnpjParaGravar('12.345.678/0001-90'), { cnpj: '12345678000190', erro: null })
  assert.deepEqual(cnpjParaGravar(''), { cnpj: null, erro: null })
  assert.equal(cnpjParaGravar('123').erro, 'CNPJ precisa de 14 dígitos')
  assert.equal(formatarCnpj('12345678000190'), '12.345.678/0001-90')
  assert.equal(formatarCnpj(null), '')
})

const t = (id, prioridade, status, criado_em, stage_id = 'e1') => ({ id, prioridade, status, criado_em, stage_id })

test('ordem: abertos primeiro, depois prioridade, depois o mais antigo', () => {
  const lista = [
    t('resolvido-urgente', 'urgente', 'resolvido', '2026-11-01'),
    t('media-antigo', 'media', 'aberto', '2026-11-01'),
    t('alta', 'alta', 'aberto', '2026-11-05'),
    t('media-novo', 'media', 'aberto', '2026-11-03'),
  ]
  assert.deepEqual(ordenarTickets(lista).map(x => x.id), ['alta', 'media-antigo', 'media-novo', 'resolvido-urgente'])
})

test('kanban: uma coluna por etapa na ordem do funil; sem etapa no começo só quando houver', () => {
  const etapas = [{ id: 'e2', nome: 'Em andamento', ordem: 1 }, { id: 'e1', nome: 'Aberto', ordem: 0 }]
  const colunas = colunasDoKanban(etapas, [t('a', 'media', 'aberto', '2026-11-01', 'e2'), t('b', 'media', 'aberto', '2026-11-02', null), t('c', 'media', 'aberto', '2026-11-03', 'apagada')])
  assert.deepEqual(colunas.map(c => [c.nome, c.tickets.map(x => x.id)]), [['Sem etapa', ['b', 'c']], ['Aberto', []], ['Em andamento', ['a']]])
  assert.deepEqual(colunasDoKanban(etapas, []).map(c => c.nome), ['Aberto', 'Em andamento'])
})
