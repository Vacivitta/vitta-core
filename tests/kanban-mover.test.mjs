import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leadNaEtapa } from '../src/components/kanban/mover.ts'

test('mover de etapa zera o relógio e usa o prazo da etapa de destino', () => {
  const vencido = {
    id: 'l1', stage_id: 'origem', stage_nome: 'Origem', stage_cor: '#000', stage_ordem: 0,
    stage_alerta_horas: 1, stage_sla_mensal: true, stage_changed_at: '2026-01-01T00:00:00Z',
  }
  const destino = { id: 'destino', nome: 'Destino', cor: '#fff', ordem: 3, alerta_horas: 48, sla_mensal: false }
  const agora = '2026-11-13T12:00:00.000Z'

  assert.deepEqual(leadNaEtapa(vencido, destino, agora), {
    id: 'l1', stage_id: 'destino', stage_nome: 'Destino', stage_cor: '#fff', stage_ordem: 3,
    stage_alerta_horas: 48, stage_sla_mensal: false, stage_changed_at: agora,
  })
})
