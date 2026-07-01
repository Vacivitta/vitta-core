'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { LeadKanban, FunnelStage } from '@/types/database'
import LeadCard from './LeadCard'

interface Props {
  stage: FunnelStage
  leads: LeadKanban[]
  onLeadClick: (lead: LeadKanban) => void
  onAddLead: (stage: FunnelStage) => void
  unreadByLead?: Record<string, number>
}

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })

export default function KanbanColumn({ stage, leads, onLeadClick, onAddLead, unreadByLead = {} }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })

  const countStyle = { backgroundColor: `${stage.cor}22`, color: stage.cor }

  const totalValue = leads.reduce((sum, l) => sum + (l.valor_negociado ?? l.valor_proposta ?? 0), 0)

  return (
    <div className="flex flex-col shrink-0 snap-start" style={{ width: '290px' }}>
      {/* Header */}
      <div
        className="bg-white rounded-t-xl px-3 py-2.5 flex items-center justify-between"
        style={{
          border: '1px solid var(--color-border)',
          borderBottom: 'none',
          borderTop: `3px solid ${stage.cor}`,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm truncate" style={{ color: 'var(--color-ink)' }}>{stage.nome}</span>
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0" style={countStyle}>
                {leads.length}
              </span>
            </div>
            {totalValue > 0 && (
              <p className="text-[11px] font-medium leading-tight" style={{ color: 'var(--color-muted)' }}>{fmt.format(totalValue)}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => onAddLead(stage)}
          className="rounded p-0.5 transition-colors hover:opacity-70"
          style={{ color: 'var(--color-muted)' }}
          title="Adicionar contato"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Drop area */}
      <div
        ref={setNodeRef}
        className="flex-1 min-h-[120px] rounded-b-xl p-2 flex flex-col gap-2 transition-colors"
        style={{
          border: '1px solid var(--color-border)',
          borderTop: 'none',
          background: isOver ? 'var(--color-brand-subtle)' : '#F3F7FA',
        }}
      >
        <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map(lead => (
            <LeadCard key={lead.id} lead={lead} onClick={() => onLeadClick(lead)} unread={unreadByLead[lead.id] ?? 0} />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <button
            onClick={() => onAddLead(stage)}
            className="flex-1 flex flex-col items-center justify-center gap-1 rounded-lg py-6 transition-opacity hover:opacity-80"
            style={{
              color: 'var(--color-muted)',
              border: '2px dashed var(--color-border)',
            }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-xs">Adicionar contato</span>
          </button>
        )}
      </div>
    </div>
  )
}
