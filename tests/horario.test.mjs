import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linhasDaSemana, problemasDaSemana, semanaDasLinhas, semanaVazia } from '../src/lib/horario.ts'

test('linhas do banco viram a semana ordenada, em HH:MM, e voltam iguais', () => {
  const linhas = [
    { dia_semana: 1, inicio: '13:00:00', fim: '18:00:00' },
    { dia_semana: 1, inicio: '08:00:00', fim: '12:00:00' },
    { dia_semana: 6, inicio: '08:00:00', fim: '12:00:00' },
  ]
  const semana = semanaDasLinhas(linhas)
  assert.deepEqual(semana[1], [{ inicio: '08:00', fim: '12:00' }, { inicio: '13:00', fim: '18:00' }])
  assert.deepEqual(semana[0], [], 'domingo fechado')
  assert.deepEqual(linhasDaSemana(semana), [
    { dia_semana: 1, inicio: '08:00', fim: '12:00' },
    { dia_semana: 1, inicio: '13:00', fim: '18:00' },
    { dia_semana: 6, inicio: '08:00', fim: '12:00' },
  ])
})

test('semana válida não tem problema; faixas encostadas (12:00 e 12:00) são válidas', () => {
  const semana = semanaVazia()
  semana[2] = [{ inicio: '08:00', fim: '12:00' }, { inicio: '12:00', fim: '18:00' }]
  assert.deepEqual(problemasDaSemana(semana), [])
})

test('acusa fim antes do início, sobreposição e faixa incompleta, com o dia', () => {
  const semana = semanaVazia()
  semana[1] = [{ inicio: '18:00', fim: '08:00' }]
  semana[3] = [{ inicio: '08:00', fim: '13:00' }, { inicio: '12:00', fim: '18:00' }]
  semana[5] = [{ inicio: '', fim: '12:00' }]
  assert.deepEqual(problemasDaSemana(semana), [
    'Segunda: 18:00–08:00 termina antes de começar',
    'Quarta: 08:00–13:00 e 12:00–18:00 se sobrepõem',
    'Sexta: preencha início e fim',
  ])
})
