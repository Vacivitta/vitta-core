'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
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
import { leadNaEtapa } from './mover'
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

/**
 * Quadro do funil com arrastar e soltar.
 *
 * O card só muda de coluna ao soltar: durante o arraste a coluna de destino fica
 * destacada e nada se reorganiza. Antes o card trocava de coluna a cada movimento
 * do mouse e era encaixado pela ordenação (não sob o ponteiro), o que fazia o
 * quadro pular e o card ir e voltar entre colunas.
 */
export default function KanbanBoard({ initialLeads, stages, onLeadClick, onAddLead, unreadByLead = {}, lastMsgByLead = {}, lastDirByLead = {}, tagsByLead = {}, onMarkUnread, sortMode = DEFAULT_KANBAN_SORT, agoraServidor, etapasAtendimento = [] }: Props) {
  const [leads, setLeads] = useState<LeadKanban[]>(initialLeads)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overStageId, setOverStageId] = useState<string | null>(null)
  const now = useNow(60_000, agoraServidor)
  // Movimentos ainda não gravados no banco: sobrepostos a qualquer recarga que
  // chegue antes da gravação, para o card não voltar à coluna antiga
  const pendentesRef = useRef(new Map<string, LeadKanban>())

  // Sincroniza com os leads do funil (Realtime/filtros), exceto durante um arraste.
  // Ao terminar o arraste, aplica o que tiver chegado nesse meio tempo.
  useEffect(() => {
    if (activeId !== null) return
    const pendentes = pendentesRef.current
    setLeads(pendentes.size ? initialLeads.map(l => pendentes.get(l.id) ?? l) : initialLeads)
  }, [initialLeads, activeId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const stageById = useMemo(() => new Map(stages.map(s => [s.id, s])), [stages])
  const sortCtx: KanbanSortContext = useMemo(
    () => ({ unreadByLead, lastMsgByLead, lastDirByLead }),
    [unreadByLead, lastMsgByLead, lastDirByLead],
  )
  const grouped = useMemo(() => groupByStage(leads, stages, sortMode, sortCtx), [leads, stages, sortMode, sortCtx])
  const activeLead = activeId ? leads.find(l => l.id === activeId) : null
  const originStageId = activeLead?.stage_id ?? null

  function resolveStageId(overId: string): string | undefined {
    if (stageById.has(overId)) return overId
    return leads.find(l => l.id === overId)?.stage_id
  }

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(active.id as string)
  }

  function handleDragOver({ over }: DragOverEvent) {
    const alvo = over ? resolveStageId(over.id as string) ?? null : null
    if (alvo !== overStageId) setOverStageId(alvo)
  }

  function handleDragCancel() {
    setActiveId(null)
    setOverStageId(null)
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    const lead = leads.find(l => l.id === active.id)
    const targetStageId = over ? resolveStageId(over.id as string) : undefined
    const targetStage = targetStageId ? stageById.get(targetStageId) : undefined
    setOverStageId(null)

    if (!lead || !over || !targetStage) { setActiveId(null); return }

    if (targetStage.id !== lead.stage_id) {
      const movido = leadNaEtapa(lead, targetStage, new Date().toISOString())
      const ordem  = grouped[targetStage.id]?.length ?? 0
      pendentesRef.current.set(lead.id, movido)
      setLeads(prev => prev.map(l => l.id === lead.id ? movido : l))
      setActiveId(null)
      try {
        await moveLeadStage(lead.id, targetStage.id, ordem, lead.stage_id, 'kanban')
      } catch (err) {
        console.error('[kanban] erro ao mover lead:', err)
        setLeads(prev => prev.map(l => l.id === lead.id ? lead : l))
        alert('Não foi possível mover o card. Confira a conexão e tente de novo.')
      } finally {
        pendentesRef.current.delete(lead.id)
      }
      return
    }

    setActiveId(null)
    // Reordenar dentro da coluna só faz sentido na ordem manual; nas demais
    // a posição é definida pelo critério escolhido.
    if (sortMode !== 'manual' || over.id === active.id) return
    const columnLeads = grouped[targetStage.id] ?? []
    const oldIndex  = columnLeads.findIndex(l => l.id === active.id)
    const newIndex  = columnLeads.findIndex(l => l.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(columnLeads, oldIndex, newIndex).map((l, i) => ({ ...l, ordem: i }))
    const porId = new Map(reordered.map(l => [l.id, l]))
    setLeads(prev => prev.map(l => porId.get(l.id) ?? l))
    try {
      await reorderLeads(reordered.map(l => ({ id: l.id, ordem: l.ordem })))
    } catch (err) {
      console.error('[kanban] erro ao reordenar:', err)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
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
            destacada={overStageId === stage.id && overStageId !== originStageId}
            reordenavel={sortMode === 'manual'}
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
