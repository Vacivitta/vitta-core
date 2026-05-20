'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { LeadKanban } from '@/types/database'

interface Props {
  lead: LeadKanban
  onClick: () => void
}

export default function LeadCard({ lead, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const hoursInStage = lead.stage_changed_at
    ? Math.floor((Date.now() - new Date(lead.stage_changed_at).getTime()) / 3_600_000)
    : 0
  const isOverdue = !!(lead.stage_alerta_horas && hoursInStage >= lead.stage_alerta_horas)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white rounded-lg border shadow-sm hover:shadow-md transition-all cursor-pointer select-none ${
        isDragging  ? 'opacity-50 shadow-lg ring-2 ring-blue-400' :
        isOverdue   ? 'border-red-300 ring-1 ring-red-100' :
                      'border-gray-200 hover:border-gray-300'
      }`}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      <div className="p-3">
        {/* Nome */}
        <p className="font-medium text-sm text-gray-900 leading-tight">
          {lead.nome} {lead.sobrenome ?? ''}
        </p>

        {/* Profissão / Cidade */}
        {(lead.profissao || lead.cidade) && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {[lead.profissao, lead.cidade].filter(Boolean).join(' · ')}
          </p>
        )}

        {/* Alerta de tempo na etapa */}
        {isOverdue && (
          <span className="inline-flex items-center gap-1 text-[10px] text-red-500 font-medium bg-red-50 px-1.5 py-0.5 rounded-full mt-1">
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {hoursInStage}h na etapa
          </span>
        )}

        {/* Badge de valor — exibe quando proposta preenchida */}
        {(lead.valor_proposta != null || lead.valor_negociado != null) && (
          <p className="text-xs font-semibold text-emerald-600 mt-1">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
              lead.valor_negociado ?? lead.valor_proposta ?? 0
            )}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
          {/* Responsável */}
          <div className="flex items-center gap-1.5">
            {lead.responsavel_avatar ? (
              <img
                src={lead.responsavel_avatar}
                alt={lead.responsavel_nome ?? ''}
                className="w-5 h-5 rounded-full object-cover"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
                <span className="text-[9px] font-bold text-blue-600">
                  {lead.responsavel_nome?.[0]?.toUpperCase() ?? '?'}
                </span>
              </div>
            )}
            <span className="text-[11px] text-gray-500 max-w-[80px] truncate">
              {lead.responsavel_nome ?? 'Sem responsável'}
            </span>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-1.5">
            {lead.tarefas_pendentes > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                {lead.tarefas_pendentes}
              </span>
            )}
            {lead.total_notas > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                {lead.total_notas}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
