'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import type { LeadKanban, FunnelStage } from '@/types/database'
import { marcarPerdido, moveLeadStage, reorderLeads } from '@/lib/leads'
import KanbanColumn from './KanbanColumn'
import LeadCard from './LeadCard'
import { useNow } from './useNow'
import { sortKanbanLeads, DEFAULT_KANBAN_SORT, type KanbanSortMode, type KanbanSortContext } from './sort'
import { faltandoDoErro } from '@/lib/obrigatorios'
import PreencherObrigatorios, { type Preenchido } from '@/components/leads/PreencherObrigatorios'
import MotivoPerdaModal from '@/components/leads/MotivoPerdaModal'

/** Movimento barrado por campos obrigatórios da etapa (migração 130); lead com a etapa de origem. */
interface MovimentoPendente {
  lead:     LeadKanban
  destino:  string
  ordem:    number
  faltando: string[]
}

/** Card solto numa etapa de perda, esperando o motivo; lead com a etapa de origem. */
interface PerdaPendente {
  lead:    LeadKanban
  destino: string
}

interface Props {
  initialLeads: LeadKanban[]
  stages: FunnelStage[]
  onLeadClick: (lead: LeadKanban) => void
  onAddLead: (stage: FunnelStage) => void
  unreadByLead?: Record<string, number>
  lastMsgByLead?: Record<string, string>
  lastDirByLead?: Record<string, 'inbound' | 'outbound'>
  tagsByLead?: Record<string, Array<{ id: string; name: string; color: string }>>
  onMarkUnread?: (leadId: string) => void
  sortMode?: KanbanSortMode
  /** Date.now() do servidor — evita diferença de hidratação nos tempos dos cards */
  agoraServidor?: number
  /** Etapas cujo alerta conta o cliente sem resposta, e não o tempo na etapa */
  etapasAtendimento?: string[]
}

/** Agrupa os leads por etapa, já na ordem exibida em cada coluna. */
function groupByStage(
  leads: LeadKanban[], stages: FunnelStage[], sortMode: KanbanSortMode, ctx: KanbanSortContext,
): Record<string, LeadKanban[]> {
  const groups: Record<string, LeadKanban[]> = {}
  for (const s of stages) groups[s.id] = []
  for (const lead of leads) {
    if (groups[lead.stage_id] !== undefined) groups[lead.stage_id].push(lead)
  }
  for (const id of Object.keys(groups)) groups[id] = sortKanbanLeads(groups[id], sortMode, ctx)
  return groups
}

export default function KanbanBoard({ initialLeads, stages, onLeadClick, onAddLead, unreadByLead = {}, lastMsgByLead = {}, lastDirByLead = {}, tagsByLead = {}, onMarkUnread, sortMode = DEFAULT_KANBAN_SORT, agoraServidor, etapasAtendimento = [] }: Props) {
  const [leads, setLeads] = useState<LeadKanban[]>(initialLeads)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pendente, setPendente] = useState<MovimentoPendente | null>(null)
  const [perdaPendente, setPerdaPendente] = useState<PerdaPendente | null>(null)
  const now = useNow(60_000, agoraServidor)
  // useRef evita o problema de stale closure — o valor é sempre atual no handleDragEnd
  // independente de quantas re-renders o handleDragOver disparar.
  const dragOriginStageRef = useRef<string | null>(null)

  // Sincroniza com os leads do funil (Realtime/filtros), exceto durante um arraste —
  // senão o card voltaria para a coluna de origem no meio do movimento (ou com o
  // motivo da perda ainda aberto)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeId === null && perdaPendente === null) setLeads(initialLeads)
  }, [initialLeads]) // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const stageIds = new Set(stages.map(s => s.id))
  const sortCtx: KanbanSortContext = { unreadByLead, lastMsgByLead, lastDirByLead }
  const grouped  = groupByStage(leads, stages, sortMode, sortCtx)
  const activeLead = activeId ? leads.find(l => l.id === activeId) : null

  function resolveStageId(overId: string): string | undefined {
    if (stageIds.has(overId)) return overId
    return leads.find(l => l.id === overId)?.stage_id
  }

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    const id = active.id as string
    setActiveId(id)
    dragOriginStageRef.current = leads.find(l => l.id === id)?.stage_id ?? null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads])

  const handleDragOver = useCallback(({ active, over }: DragOverEvent) => {
    if (!over) return
    const currentStage = leads.find(l => l.id === active.id)?.stage_id
    const targetStage  = resolveStageId(over.id as string)
    if (!currentStage || !targetStage || currentStage === targetStage) return

    setLeads(prev =>
      prev.map(l => l.id === active.id ? { ...l, stage_id: targetStage } : l)
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, stageIds])

  function voltarParaOrigem(leadId: string, origem: string) {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage_id: origem } : l))
  }

  function tratarErroAoMover(err: unknown, mov: Omit<MovimentoPendente, 'faltando'>) {
    const f = faltandoDoErro(err)
    if (f) { setPendente({ ...mov, faltando: f.faltando }); return }
    console.error('[kanban] erro ao mover lead:', err)
    alert('Não foi possível mover o lead. Tente de novo.')
  }

  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    const originStage = dragOriginStageRef.current
    dragOriginStageRef.current = null

    const lead = leads.find(l => l.id === active.id)
    if (!lead) return
    // Solto fora de uma coluna: o handleDragOver já pode ter trocado a coluna na tela
    if (!over) {
      if (originStage) voltarParaOrigem(lead.id, originStage)
      return
    }

    const targetStageId = resolveStageId(over.id as string) ?? lead.stage_id
    // Mesma ordem exibida na coluna, para os índices do arraste baterem com a tela
    const columnLeads   = sortKanbanLeads(leads.filter(l => l.stage_id === targetStageId), sortMode, sortCtx)

    if (originStage && originStage !== targetStageId) {
      const ordem = columnLeads.length
      // Perder pelo kanban pede o motivo, como na ficha; o card espera na coluna de perda
      if (stages.find(s => s.id === targetStageId)?.resultado === 'perdido' && lead.status !== 'perdido') {
        setPerdaPendente({ lead: { ...lead, stage_id: originStage }, destino: targetStageId })
        return
      }
      try {
        await moveLeadStage(lead.id, targetStageId, ordem, originStage, 'kanban')
        setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, stage_id: targetStageId } : l))
      } catch (err) {
        voltarParaOrigem(lead.id, originStage)
        tratarErroAoMover(err, { lead: { ...lead, stage_id: originStage }, destino: targetStageId, ordem })
      }
      return
    }

    // Reordenar dentro da coluna só faz sentido na ordem manual; nas demais
    // a posição é definida pelo critério escolhido.
    if (over.id === active.id || sortMode !== 'manual') return
    const oldIndex  = columnLeads.findIndex(l => l.id === active.id)
    const newIndex  = columnLeads.findIndex(l => l.id === over.id)
    const reordered = arrayMove(columnLeads, oldIndex, newIndex).map((l, i) => ({ ...l, ordem: i }))
    try {
      await reorderLeads(reordered.map(l => ({ id: l.id, ordem: l.ordem })))
      setLeads(prev => prev.map(l => reordered.find(r => r.id === l.id) ?? l))
    } catch (err) {
      console.error('[kanban] erro ao reordenar leads:', err)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, stages, stageIds, sortMode, unreadByLead, lastMsgByLead, lastDirByLead])

  async function perderDepoisDoMotivo(p: PerdaPendente, motivoId: string, detalhe: string | null) {
    await marcarPerdido(p.lead.id, motivoId, detalhe, p.destino)
    setLeads(prev => prev.map(l => l.id === p.lead.id ? { ...l, stage_id: p.destino, status: 'perdido' } : l))
    setPerdaPendente(null)
  }

  function cancelarPerda(p: PerdaPendente) {
    voltarParaOrigem(p.lead.id, p.lead.stage_id)
    setPerdaPendente(null)
  }

  async function moverDepoisDePreencher(p: MovimentoPendente, valores: Preenchido) {
    setLeads(prev => prev.map(l => l.id === p.lead.id ? { ...l, ...valores.fixos } : l))
    try {
      await moveLeadStage(p.lead.id, p.destino, p.ordem, p.lead.stage_id, 'kanban')
      setLeads(prev => prev.map(l => l.id === p.lead.id ? { ...l, stage_id: p.destino } : l))
      setPendente(null)
    } catch (err) {
      setPendente(null)
      tratarErroAoMover(err, p)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-4 px-2 sm:px-1 h-full snap-x snap-mandatory sm:snap-none">
        {stages.map(stage => (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            leads={grouped[stage.id] ?? []}
            onLeadClick={onLeadClick}
            onAddLead={onAddLead}
            unreadByLead={unreadByLead}
            lastMsgByLead={lastMsgByLead}
            lastDirByLead={lastDirByLead}
            alertaPorResposta={etapasAtendimento.includes(stage.id)}
            tagsByLead={tagsByLead}
            onMarkUnread={onMarkUnread}
            now={now}
          />
        ))}
      </div>

      <DragOverlay>
        {activeLead && (
          <div className="rotate-2 opacity-90">
            <LeadCard lead={activeLead} onClick={() => {}} now={now} />
          </div>
        )}
      </DragOverlay>

      {pendente && (
        <PreencherObrigatorios
          key={pendente.lead.id + pendente.destino}
          leadId={pendente.lead.id}
          unitId={pendente.lead.unit_id}
          funnelId={pendente.lead.funnel_id}
          etapaNome={stages.find(s => s.id === pendente.destino)?.nome ?? 'a etapa'}
          faltando={pendente.faltando}
          onCancelar={() => setPendente(null)}
          onPreenchido={valores => moverDepoisDePreencher(pendente, valores)}
        />
      )}

      {perdaPendente && (
        <MotivoPerdaModal
          key={perdaPendente.lead.id + perdaPendente.destino}
          funnelId={perdaPendente.lead.funnel_id}
          descricao={`${perdaPendente.lead.nome} vai para a etapa "${stages.find(s => s.id === perdaPendente.destino)?.nome ?? 'de perda'}". Se mandar mensagem, o negócio reabre.`}
          onCancelar={() => cancelarPerda(perdaPendente)}
          onConfirmar={(motivoId, detalhe) => perderDepoisDoMotivo(perdaPendente, motivoId, detalhe)}
        />
      )}
    </DndContext>
  )
}
