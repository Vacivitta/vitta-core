'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { LeadKanban } from '@/types/database'

interface TagInfo { id: string; name: string; color: string }

interface Props {
  lead: LeadKanban
  onClick: () => void
  unread?: number
  tags?: TagInfo[]
  onMarkUnread?: (leadId: string) => void
  lastMsgAt?: string
}

function timeSince(dateStr: string): { label: string; isLong: boolean } {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 1) return { label: 'agora', isLong: false }
  if (mins < 60) return { label: `${mins}min`, isLong: false }
  if (hours < 24) return { label: `${hours}h`, isLong: false }
  return { label: `${days}d`, isLong: days >= 3 }
}

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function fmtTaskDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow = d.toDateString() === tomorrow.toDateString()

  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (isToday) return `Hoje ${time}`
  if (isTomorrow) return `Amanhã ${time}`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ` ${time}`
}

export default function LeadCard({ lead, onClick, unread = 0, tags, onMarkUnread, lastMsgAt }: Props) {
  const [hovered, setHovered] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
  })

  const dndStyle = { transform: CSS.Transform.toString(transform), transition }

  const hoursInStage = lead.stage_changed_at
    ? Math.floor((Date.now() - new Date(lead.stage_changed_at).getTime()) / 3_600_000)
    : 0
  const isSlaOverdue = !!(lead.stage_alerta_horas && hoursInStage >= lead.stage_alerta_horas)

  const taskOverdue = lead.proxima_tarefa_data
    ? new Date(lead.proxima_tarefa_data).getTime() < Date.now()
    : false

  const displayValue = lead.valor_negociado ?? lead.valor_proposta ?? (lead.valor_orcamentos > 0 ? lead.valor_orcamentos : null)

  const initials = `${(lead.nome?.[0] ?? '').toUpperCase()}${(lead.sobrenome?.[0] ?? '').toUpperCase()}`
  const timeInfo = lastMsgAt ? timeSince(lastMsgAt) : lead.stage_changed_at ? timeSince(lead.stage_changed_at) : null

  const cardStyle: React.CSSProperties = {
    ...dndStyle,
    background: isSlaOverdue ? '#FEF2F2' : '#fff',
    borderRadius: 10,
    border: isDragging
      ? '1.5px solid #3E9849'
      : isSlaOverdue
        ? '1.5px solid #FCA5A5'
        : '1px solid #EBEBEB',
    boxShadow: isDragging
      ? '0 6px 16px -4px rgba(0,0,0,0.15)'
      : hovered
        ? '0 2px 8px -2px rgba(0,0,0,0.1)'
        : '0 1px 2px rgba(0,0,0,0.04)',
    cursor: 'pointer',
    userSelect: 'none',
    opacity: isDragging ? 0.5 : 1,
    transition: 'box-shadow 0.15s, border-color 0.15s, background 0.15s',
  }

  return (
    <div
      ref={setNodeRef}
      className="group"
      style={cardStyle}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...attributes}
      {...listeners}
    >
      <div style={{ padding: '10px 12px' }}>
        {/* Name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: isSlaOverdue ? '#FEE2E2' : '#F3F4F6',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: isSlaOverdue ? '#DC2626' : '#6B7280' }}>
              {initials || '?'}
            </span>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{
              fontSize: 13, fontWeight: 700, color: '#1a1a1a',
              display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {lead.nome} {lead.sobrenome ?? ''}
            </span>
            {(lead.profissao || lead.cidade) && (
              <span style={{
                fontSize: 11, color: '#999',
                display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {[lead.profissao, lead.cidade].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>

          {unread > 0 && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
              background: '#25D366', color: '#fff', flexShrink: 0,
            }}>
              {unread}
            </span>
          )}
        </div>

        {/* Value */}
        {displayValue != null && (
          <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>
            {fmtBRL.format(displayValue)}
          </p>
        )}

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {tags.map(tag => (
              <span key={tag.id} style={{
                fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                background: tag.color + '15', color: tag.color,
              }}>
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* SLA overdue */}
        {isSlaOverdue && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 10, fontWeight: 600, marginTop: 6,
            padding: '2px 6px', borderRadius: 4,
            background: '#FEE2E2', color: '#DC2626',
          }}>
            <svg width="9" height="9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {hoursInStage >= 24 ? `${Math.floor(hoursInStage / 24)}d` : `${hoursInStage}h`} na etapa
          </div>
        )}

        {/* Next task */}
        {lead.proxima_tarefa_data && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 10, fontWeight: 600, marginTop: 6,
            marginLeft: isSlaOverdue ? 4 : 0,
            padding: '2px 6px', borderRadius: 4,
            background: taskOverdue ? '#FEE2E2' : '#EFF6FF',
            color: taskOverdue ? '#DC2626' : '#2563EB',
          }}>
            <svg width="9" height="9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {fmtTaskDate(lead.proxima_tarefa_data)}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid #F3F4F6', padding: '6px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
          {lead.responsavel_nome ? (
            <>
              {lead.responsavel_avatar ? (
                <img src={lead.responsavel_avatar} alt={lead.responsavel_nome}
                  style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                  background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: '#9CA3AF' }}>
                    {lead.responsavel_nome[0]?.toUpperCase()}
                  </span>
                </div>
              )}
              <span style={{ fontSize: 11, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lead.responsavel_nome}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 10, fontWeight: 600, color: '#D97706' }}>
              sem responsável
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {unread === 0 && onMarkUnread && (
            <span
              role="button"
              title="Marcar como não lida"
              className="group-hover:opacity-100!"
              onClick={e => { e.stopPropagation(); onMarkUnread(lead.id) }}
              style={{ opacity: 0, cursor: 'pointer', padding: 2, borderRadius: 4, display: 'inline-flex', transition: 'opacity 0.15s' }}
            >
              <svg width="10" height="10" fill="none" stroke="#bbb" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            </span>
          )}
          {lead.tarefas_pendentes > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 2,
              fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
              background: taskOverdue ? '#FEE2E2' : '#FEF3C7',
              color: taskOverdue ? '#DC2626' : '#B45309',
            }}>
              <svg width="9" height="9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              {lead.tarefas_pendentes}
            </span>
          )}
          {lead.total_notas > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 2,
              fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
              background: '#F3F4F6', color: '#9CA3AF',
            }}>
              <svg width="9" height="9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              {lead.total_notas}
            </span>
          )}
          {timeInfo && (
            <span style={{
              fontSize: 10, fontWeight: 600, flexShrink: 0,
              color: timeInfo.isLong ? '#B45309' : '#bbb',
            }}>
              {timeInfo.label}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
