'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { LeadKanban } from '@/types/database'

interface Props {
  lead: LeadKanban
  onClick: () => void
  unread?: number
}

export default function LeadCard({ lead, onClick, unread = 0 }: Props) {
  const [hovered, setHovered] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
  })

  const dndStyle = { transform: CSS.Transform.toString(transform), transition }

  const hoursInStage = lead.stage_changed_at
    ? Math.floor((Date.now() - new Date(lead.stage_changed_at).getTime()) / 3_600_000)
    : 0
  const isOverdue = !!(lead.stage_alerta_horas && hoursInStage >= lead.stage_alerta_horas)

  const cardStyle: React.CSSProperties = {
    ...dndStyle,
    background: 'var(--color-surface)',
    borderRadius: 'var(--radius-card-sm)',
    border: isDragging
      ? '1px solid var(--color-brand)'
      : isOverdue
        ? '1px solid var(--color-danger)'
        : hovered
          ? '1px solid #D7E6F0'
          : '1px solid #EAEFF4',
    boxShadow: isDragging ? 'var(--shadow-card-hover)' : hovered ? '0 8px 20px -8px rgba(16,44,61,0.18)' : 'var(--shadow-sm)',
    cursor: 'pointer',
    userSelect: 'none',
    opacity: isDragging ? 0.5 : 1,
    transition: 'box-shadow 0.15s, border-color 0.15s',
  }

  return (
    <div
      ref={setNodeRef}
      style={cardStyle}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...attributes}
      {...listeners}
    >
      <div style={{ padding: '14px' }}>
        {/* Nome */}
        <p className="font-medium text-sm leading-tight" style={{ color: 'var(--color-ink)' }}>
          {lead.nome} {lead.sobrenome ?? ''}
        </p>

        {/* Profissão / Cidade */}
        {(lead.profissao || lead.cidade) && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>
            {[lead.profissao, lead.cidade].filter(Boolean).join(' · ')}
          </p>
        )}

        {/* Alerta de tempo na etapa */}
        {isOverdue && (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full mt-1"
            style={{ background: 'var(--color-danger-subtle)', color: 'var(--color-danger-text)' }}
          >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {hoursInStage}h na etapa
          </span>
        )}

        {/* Badge de valor */}
        {(lead.valor_proposta != null || lead.valor_negociado != null) && (
          <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-success-text)' }}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
              lead.valor_negociado ?? lead.valor_proposta ?? 0
            )}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          {/* Responsável */}
          <div className="flex items-center gap-1.5">
            {lead.responsavel_avatar ? (
              <img
                src={lead.responsavel_avatar}
                alt={lead.responsavel_nome ?? ''}
                style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <div style={{ width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-brand-subtle)' }}>
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-brand)' }}>
                  {lead.responsavel_nome?.[0]?.toUpperCase() ?? '?'}
                </span>
              </div>
            )}
            <span style={{ fontSize: '11.5px', color: 'var(--color-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lead.responsavel_nome ?? 'Sem responsável'}
            </span>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-1.5">
            {unread > 0 && (
              <span
                className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: '#25D366', color: '#fff' }}
                title={`${unread} mensagem${unread > 1 ? 's' : ''} não lida${unread > 1 ? 's' : ''}`}
              >
                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.565 4.14 1.548 5.876L0 24l6.324-1.524A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.6a9.587 9.587 0 01-4.896-1.34l-.352-.209-3.652.88.907-3.55-.228-.365A9.567 9.567 0 012.4 12C2.4 6.698 6.698 2.4 12 2.4S21.6 6.698 21.6 12 17.302 21.6 12 21.6z"/>
                </svg>
                {unread}
              </span>
            )}
            {lead.tarefas_pendentes > 0 && (
              <span
                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent-text)' }}
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                {lead.tarefas_pendentes}
              </span>
            )}
            {lead.total_notas > 0 && (
              <span
                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--color-track)', color: 'var(--color-muted)' }}
              >
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
