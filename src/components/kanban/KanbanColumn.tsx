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
}

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })

export default function KanbanColumn({ stage, leads, onLeadClick, onAddLead }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })

  const headerStyle = { borderTopColor: stage.cor }
  const countStyle  = { backgroundColor: `${stage.cor}22`, color: stage.cor }

  const totalValue = leads.reduce((sum, l) => sum + (l.valor_negociado ?? l.valor_proposta ?? 0), 0)

  return (
    <div className="flex flex-col w-[82vw] sm:w-72 shrink-0 snap-start">
      {/* Header */}
      <div
        className="bg-white rounded-t-xl border border-b-0 border-gray-200 border-t-4 px-3 py-2.5 flex items-center justify-between"
        style={headerStyle}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-gray-800 truncate">{stage.nome}</span>
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0" style={countStyle}>
                {leads.length}
              </span>
            </div>
            {totalValue > 0 && (
              <p className="text-[11px] text-gray-400 font-medium leading-tight">{fmt.format(totalValue)}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => onAddLead(stage)}
          className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded p-0.5 transition-colors"
          title="Adicionar lead"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Drop area */}
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-[120px] rounded-b-xl border border-t-0 border-gray-200 p-2 flex flex-col gap-2 transition-colors ${
          isOver ? 'bg-blue-50 border-blue-300' : 'bg-gray-50'
        }`}
      >
        <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map(lead => (
            <LeadCard key={lead.id} lead={lead} onClick={() => onLeadClick(lead)} />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <button
            onClick={() => onAddLead(stage)}
            className="flex-1 flex flex-col items-center justify-center gap-1 text-gray-300 hover:text-gray-400 hover:bg-gray-100 rounded-lg py-6 transition-colors border-2 border-dashed border-gray-200 hover:border-gray-300"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-xs">Adicionar lead</span>
          </button>
        )}
      </div>
    </div>
  )
}
