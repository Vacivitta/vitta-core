'use client'

import { useState, useCallback, useOptimistic } from 'react'
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
import type { LeadKanban, LeadStage } from '@/types/database'
import { STAGE_ORDER } from '@/types/database'
import { moveLeadStage, reorderLeads } from '@/lib/leads'
import KanbanColumn from './KanbanColumn'
import LeadCard from './LeadCard'

interface Props {
  initialLeads: LeadKanban[]
  onLeadClick: (lead: LeadKanban) => void
  onAddLead: (stage: LeadStage) => void
}

function groupByStage(leads: LeadKanban[]): Record<LeadStage, LeadKanban[]> {
  const groups = {} as Record<LeadStage, LeadKanban[]>
  for (const stage of STAGE_ORDER) groups[stage] = []
  for (const lead of leads) groups[lead.stage].push(lead)
  return groups
}

export default function KanbanBoard({ initialLeads, onLeadClick, onAddLead }: Props) {
  const [leads, setLeads] = useState<LeadKanban[]>(initialLeads)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const grouped = groupByStage(leads)
  const activeLead = activeId ? leads.find(l => l.id === activeId) : null

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    setActiveId(active.id as string)
  }, [])

  const handleDragOver = useCallback(({ active, over }: DragOverEvent) => {
    if (!over) return
    const activeStage = leads.find(l => l.id === active.id)?.stage
    const overStage = (STAGE_ORDER.includes(over.id as LeadStage)
      ? over.id
      : leads.find(l => l.id === over.id)?.stage) as LeadStage | undefined

    if (!activeStage || !overStage || activeStage === overStage) return

    setLeads(prev =>
      prev.map(l => (l.id === active.id ? { ...l, stage: overStage } : l))
    )
  }, [leads])

  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    if (!over) return

    const lead = leads.find(l => l.id === active.id)
    if (!lead) return

    const overStage = (STAGE_ORDER.includes(over.id as LeadStage)
      ? over.id
      : leads.find(l => l.id === over.id)?.stage) as LeadStage | undefined

    const targetStage = overStage ?? lead.stage
    const columnLeads = leads.filter(l => l.stage === targetStage)

    let newLeads = [...leads]

    if (lead.stage !== targetStage) {
      newLeads = newLeads.map(l => (l.id === lead.id ? { ...l, stage: targetStage } : l))
      await moveLeadStage(lead.id, targetStage, columnLeads.length)
    } else if (over.id !== active.id) {
      const oldIndex = columnLeads.findIndex(l => l.id === active.id)
      const newIndex = columnLeads.findIndex(l => l.id === over.id)
      const reordered = arrayMove(columnLeads, oldIndex, newIndex).map((l, i) => ({ ...l, ordem: i }))
      newLeads = newLeads.map(l => reordered.find(r => r.id === l.id) ?? l)
      await reorderLeads(reordered.map(l => ({ id: l.id, ordem: l.ordem })))
    }

    setLeads(newLeads)
  }, [leads])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 px-1 h-full">
        {STAGE_ORDER.map(stage => (
          <KanbanColumn
            key={stage}
            stage={stage}
            leads={grouped[stage]}
            onLeadClick={onLeadClick}
            onAddLead={onAddLead}
          />
        ))}
      </div>

      <DragOverlay>
        {activeLead && (
          <div className="rotate-2 opacity-90">
            <LeadCard lead={activeLead} onClick={() => {}} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
