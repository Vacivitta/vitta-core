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
import { moveLeadStage, reorderLeads } from '@/lib/leads'
import KanbanColumn from './KanbanColumn'
import LeadCard from './LeadCard'
import { useNow } from './useNow'
import { sortKanbanLeads, DEFAULT_KANBAN_SORT, type KanbanSortMode, type KanbanSortContext } from './sort'

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

export default function KanbanBoard({ initialLeads, stages, onLeadClick, onAddLead, unreadByLead = {}, lastMsgByLead = {}, lastDirByLead = {}, tagsByLead = {}, onMarkUnread, sortMode = DEFAULT_KANBAN_SORT }: Props) {
  const [leads, setLeads] = useState<LeadKanban[]>(initialLeads)
  const [activeId, setActiveId] = useState<string | null>(null)
  const now = useNow()
  // useRef evita o problema de stale closure — o valor é sempre atual no handleDragEnd
  // independente de quantas re-renders o handleDragOver disparar.
  const dragOriginStageRef = useRef<string | null>(null)

  // Sincroniza com os leads do funil (Realtime/filtros), exceto durante um arraste —
  // senão o card voltaria para a coluna de origem no meio do movimento
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeId === null) setLeads(initialLeads)
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

  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    const originStage = dragOriginStageRef.current
    dragOriginStageRef.current = null
    if (!over) return

    const lead = leads.find(l => l.id === active.id)
    if (!lead) return

    const targetStageId = resolveStageId(over.id as string) ?? lead.stage_id
    // Mesma ordem exibida na coluna, para os índices do arraste baterem com a tela
    const columnLeads   = sortKanbanLeads(leads.filter(l => l.stage_id === targetStageId), sortMode, sortCtx)

    let newLeads = [...leads]

    try {
      if (originStage && originStage !== targetStageId) {
        newLeads = newLeads.map(l => l.id === lead.id ? { ...l, stage_id: targetStageId } : l)
        await moveLeadStage(lead.id, targetStageId, columnLeads.length, originStage, 'kanban')
      } else if (over.id !== active.id && sortMode === 'manual') {
        // Reordenar dentro da coluna só faz sentido na ordem manual; nas demais
        // a posição é definida pelo critério escolhido.
        const oldIndex  = columnLeads.findIndex(l => l.id === active.id)
        const newIndex  = columnLeads.findIndex(l => l.id === over.id)
        const reordered = arrayMove(columnLeads, oldIndex, newIndex).map((l, i) => ({ ...l, ordem: i }))
        newLeads = newLeads.map(l => reordered.find(r => r.id === l.id) ?? l)
        await reorderLeads(reordered.map(l => ({ id: l.id, ordem: l.ordem })))
      }
    } catch (err) {
      console.error('[kanban] erro ao mover lead:', err)
    }

    setLeads(newLeads)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, stageIds, sortMode, unreadByLead, lastMsgByLead, lastDirByLead])

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
    </DndContext>
  )
}
