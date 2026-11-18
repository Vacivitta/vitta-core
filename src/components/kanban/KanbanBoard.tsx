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
import { marcarPerdido, moveLeadStage, reorderLeads } from '@/lib/leads'
import KanbanColumn from './KanbanColumn'
import LeadCard from './LeadCard'
import { useNow } from './useNow'
import { leadNaEtapa } from './mover'
import { sortKanbanLeads, DEFAULT_KANBAN_SORT, type KanbanSortMode, type KanbanSortContext } from './sort'
import { faltandoDoErro } from '@/lib/obrigatorios'
import PreencherObrigatorios, { type Preenchido } from '@/components/leads/PreencherObrigatorios'
import MotivoPerdaModal from '@/components/leads/MotivoPerdaModal'

/** Movimento barrado por campos obrigatórios da etapa (migração 130); lead com a etapa de origem. */
interface MovimentoPendente {
  lead:     LeadKanban
  destino:  FunnelStage
  ordem:    number
  faltando: string[]
}

/** Card solto numa etapa de perda, esperando o motivo; lead com a etapa de origem. */
interface PerdaPendente {
  lead:    LeadKanban
  destino: FunnelStage
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
  const [pendente, setPendente] = useState<MovimentoPendente | null>(null)
  const [perdaPendente, setPerdaPendente] = useState<PerdaPendente | null>(null)
  const now = useNow(60_000, agoraServidor)
  // Movimentos ainda não gravados no banco: sobrepostos a qualquer recarga que
  // chegue antes da gravação, para o card não voltar à coluna antiga
  const gravandoRef = useRef(new Map<string, LeadKanban>())

  // Sincroniza com os leads do funil (Realtime/filtros), exceto durante um arraste
  // ou com o motivo da perda aberto. Ao terminar, aplica o que chegou nesse meio tempo.
  useEffect(() => {
    if (activeId !== null || perdaPendente !== null) return
    const gravando = gravandoRef.current
    setLeads(gravando.size ? initialLeads.map(l => gravando.get(l.id) ?? l) : initialLeads)
  }, [initialLeads, activeId, perdaPendente])

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

  function tratarErroAoMover(err: unknown, mov: Omit<MovimentoPendente, 'faltando'>) {
    const f = faltandoDoErro(err)
    if (f) { setPendente({ ...mov, faltando: f.faltando }); return }
    console.error('[kanban] erro ao mover lead:', err)
    alert('Não foi possível mover o lead. Tente de novo.')
  }

  /**
   * Mostra o card já na etapa de destino (relógio zerado, prazo da nova etapa) e
   * grava; em erro volta para a origem.
   */
  async function mover(lead: LeadKanban, destino: FunnelStage, ordem: number) {
    const movido = leadNaEtapa(lead, destino, new Date().toISOString())
    gravandoRef.current.set(lead.id, movido)
    setLeads(prev => prev.map(l => l.id === lead.id ? movido : l))
    try {
      await moveLeadStage(lead.id, destino.id, ordem, lead.stage_id, 'kanban')
    } catch (err) {
      setLeads(prev => prev.map(l => l.id === lead.id ? lead : l))
      tratarErroAoMover(err, { lead, destino, ordem })
    } finally {
      gravandoRef.current.delete(lead.id)
    }
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    const lead = leads.find(l => l.id === active.id)
    const targetStageId = over ? resolveStageId(over.id as string) : undefined
    const destino = targetStageId ? stageById.get(targetStageId) : undefined
    setOverStageId(null)

    if (!lead || !over || !destino) { setActiveId(null); return }

    if (destino.id !== lead.stage_id) {
      const ordem = grouped[destino.id]?.length ?? 0
      // Perder pelo kanban pede o motivo, como na ficha; o card espera na origem
      if (destino.resultado === 'perdido' && lead.status !== 'perdido') {
        setPerdaPendente({ lead, destino })
        setActiveId(null)
        return
      }
      setActiveId(null)
      await mover(lead, destino, ordem)
      return
    }

    setActiveId(null)
    // Reordenar dentro da coluna só faz sentido na ordem manual; nas demais
    // a posição é definida pelo critério escolhido.
    if (sortMode !== 'manual' || over.id === active.id) return
    const columnLeads = grouped[destino.id] ?? []
    const oldIndex  = columnLeads.findIndex(l => l.id === active.id)
    const newIndex  = columnLeads.findIndex(l => l.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(columnLeads, oldIndex, newIndex).map((l, i) => ({ ...l, ordem: i }))
    const porId = new Map(reordered.map(l => [l.id, l]))
    setLeads(prev => prev.map(l => porId.get(l.id) ?? l))
    try {
      await reorderLeads(reordered.map(l => ({ id: l.id, ordem: l.ordem })))
    } catch (err) {
      console.error('[kanban] erro ao reordenar leads:', err)
    }
  }

  async function perderDepoisDoMotivo(p: PerdaPendente, motivoId: string, detalhe: string | null) {
    await marcarPerdido(p.lead.id, motivoId, detalhe, p.destino.id)
    const perdido = { ...leadNaEtapa(p.lead, p.destino, new Date().toISOString()), status: 'perdido' as const }
    setLeads(prev => prev.map(l => l.id === p.lead.id ? perdido : l))
    setPerdaPendente(null)
  }

  async function moverDepoisDePreencher(p: MovimentoPendente, valores: Preenchido) {
    setPendente(null)
    await mover({ ...p.lead, ...valores.fixos }, p.destino, p.ordem)
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

      {pendente && (
        <PreencherObrigatorios
          key={pendente.lead.id + pendente.destino.id}
          leadId={pendente.lead.id}
          unitId={pendente.lead.unit_id}
          funnelId={pendente.lead.funnel_id}
          etapaNome={pendente.destino.nome}
          faltando={pendente.faltando}
          onCancelar={() => setPendente(null)}
          onPreenchido={valores => moverDepoisDePreencher(pendente, valores)}
        />
      )}

      {perdaPendente && (
        <MotivoPerdaModal
          key={perdaPendente.lead.id + perdaPendente.destino.id}
          funnelId={perdaPendente.lead.funnel_id}
          descricao={`${perdaPendente.lead.nome} vai para a etapa "${perdaPendente.destino.nome}". Se mandar mensagem, o negócio reabre.`}
          onCancelar={() => setPerdaPendente(null)}
          onConfirmar={(motivoId, detalhe) => perderDepoisDoMotivo(perdaPendente, motivoId, detalhe)}
        />
      )}
    </DndContext>
  )
}
