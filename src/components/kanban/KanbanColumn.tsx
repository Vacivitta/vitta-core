'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { LeadKanban, LeadStage } from '@/types/database'
import { STAGE_LABELS } from '@/types/database'
import LeadCard from './LeadCard'

const STAGE_COLORS: Record<LeadStage, string> = {
  lead:               'border-t-slate-400',
  lead_em_interacao:  'border-t-blue-400',
  reuniao:            'border-t-violet-400',
  negociacao:         'border-t-amber-400',
  followup_proposta:  'border-t-orange-400',
  vendido:            'border-t-emerald-500',
  perdido:            'border-t-red-400',
}

const STAGE_COUNT_COLORS: Record<LeadStage, string> = {
  lead:               'bg-slate-100 text-slate-600',
  lead_em_interacao:  'bg-blue-100 text-blue-700',
  reuniao:            'bg-violet-100 text-violet-700',
  negociacao:         'bg-amber-100 text-amber-700',
  followup_proposta:  'bg-orange-100 text-orange-700',
  vendido:            'bg-emerald-100 text-emerald-700',
  perdido:            'bg-red-100 text-red-700',
}

interface Props {
  stage: LeadStage
  leads: LeadKanban[]
  onLeadClick: (lead: LeadKanban) => void
  onAddLead: (stage: LeadStage) => void
}

export default function KanbanColumn({ stage, leads, onLeadClick, onAddLead }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })

  return (
    <div className="flex flex-col w-72 shrink-0">
      {/* Header */}
      <div className={`bg-white rounded-t-xl border border-b-0 border-gray-200 border-t-4 ${STAGE_COLORS[stage]} px-3 py-2.5 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-gray-800">{STAGE_LABELS[stage]}</span>
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${STAGE_COUNT_COLORS[stage]}`}>
            {leads.length}
          </span>
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
