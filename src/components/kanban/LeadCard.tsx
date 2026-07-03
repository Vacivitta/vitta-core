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

const AVATAR_BG   = ['#D6EBD2', '#DCEFFA', '#F3EBDA'] as const
const AVATAR_INK  = ['#3E6B38', '#2A6B99', '#8B6A2F'] as const

function hashIdx(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h) % 3
}

function timeSince(dateStr: string): { label: string; isLong: boolean } {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 1) return { label: 'agora', isLong: false }
  if (mins < 60) return { label: `${mins}min`, isLong: false }
  if (hours < 24) return { label: `${hours}h`, isLong: false }
  return { label: `${days}d`, isLong: true }
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
  const isOverdue = !!(lead.stage_alerta_horas && hoursInStage >= lead.stage_alerta_horas)
  const isUrgent = lead.stage_changed_at
    ? (Date.now() - new Date(lead.stage_changed_at).getTime()) >= 48 * 3_600_000
    : false

  const pi = hashIdx(lead.id)
  const initials = `${(lead.nome?.[0] ?? '').toUpperCase()}${(lead.sobrenome?.[0] ?? '').toUpperCase()}`
  const timeInfo = lastMsgAt ? timeSince(lastMsgAt) : lead.stage_changed_at ? timeSince(lead.stage_changed_at) : null

  const cardStyle: React.CSSProperties = {
    ...dndStyle,
    background: '#fff',
    borderRadius: 16,
    border: isDragging
      ? '2px solid #3E9849'
      : isUrgent && isOverdue
        ? '1.5px solid #C87F1B'
        : hovered ? '1px solid #C8D9C4' : '1px solid #EBE7DA',
    boxShadow: isDragging
      ? '0 8px 20px -6px rgba(37,64,44,0.2)'
      : hovered
        ? '0 6px 16px -4px rgba(37,64,44,0.15)'
        : '0 2px 6px -2px rgba(37,64,44,0.12)',
    cursor: 'pointer',
    userSelect: 'none',
    opacity: isDragging ? 0.5 : 1,
    transition: 'box-shadow 0.15s, border-color 0.15s, transform 0.15s',
    transform: hovered && !isDragging
      ? `${dndStyle.transform ?? ''} translateY(-1px)`.trim()
      : dndStyle.transform ?? undefined,
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
      <div style={{ padding: 14 }}>
        {/* Avatar + Name + Time */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 12, flexShrink: 0,
            background: AVATAR_BG[pi],
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: AVATAR_INK[pi], letterSpacing: '-0.02em' }}>
              {initials || '?'}
            </span>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 13.5, fontWeight: 700, color: '#25402C',
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {lead.nome} {lead.sobrenome ?? ''}
              </span>
              {timeInfo && (
                <span style={{
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                  color: timeInfo.isLong ? '#C87F1B' : '#9AA79C',
                }}>
                  {timeInfo.isLong && '⚠ '}{timeInfo.label}
                </span>
              )}
            </div>

            {(lead.profissao || lead.cidade) && (
              <p style={{
                margin: 0, fontSize: 11.5, color: '#8A977F',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {[lead.profissao, lead.cidade].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
            {tags.map(tag => (
              <span key={tag.id} style={{
                fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                background: tag.color + '18', color: tag.color,
                border: `1px solid ${tag.color}33`, letterSpacing: '0.02em',
              }}>
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* Overdue alert */}
        {isOverdue && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 600, marginTop: 6,
            padding: '3px 8px', borderRadius: 99,
            background: '#FEF3E2', color: '#C87F1B',
          }}>
            <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {hoursInStage}h na etapa
          </div>
        )}

        {/* Value */}
        {(lead.valor_proposta != null || lead.valor_negociado != null) && (
          <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 700, color: '#3E8B50' }}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
              lead.valor_negociado ?? lead.valor_proposta ?? 0
            )}
          </p>
        )}
      </div>

      {/* Footer — dashed separator */}
      <div style={{
        borderTop: '1.5px dashed #E4DFD0', margin: '0 14px', padding: '8px 0 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          {lead.responsavel_nome ? (
            <>
              {lead.responsavel_avatar ? (
                <img
                  src={lead.responsavel_avatar}
                  alt={lead.responsavel_nome}
                  style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  background: '#D6EBD2', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: '#3E6B38' }}>
                    {lead.responsavel_nome[0]?.toUpperCase()}
                  </span>
                </div>
              )}
              <span style={{ fontSize: 11, color: '#8A977F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lead.responsavel_nome}
              </span>
            </>
          ) : (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
              background: '#FEF3E2', color: '#C87F1B',
            }}>
              sem responsável
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          {unread === 0 && onMarkUnread && (
            <span
              role="button"
              title="Marcar como não lida"
              className="group-hover:opacity-100!"
              onClick={e => { e.stopPropagation(); onMarkUnread(lead.id) }}
              style={{ opacity: 0, cursor: 'pointer', padding: 2, borderRadius: 4, display: 'inline-flex', transition: 'opacity 0.15s' }}
            >
              <svg width="11" height="11" fill="none" stroke="#9AA79C" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            </span>
          )}
          {unread > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999,
              background: '#25D366', color: '#fff',
            }}>
              <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.565 4.14 1.548 5.876L0 24l6.324-1.524A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.6a9.587 9.587 0 01-4.896-1.34l-.352-.209-3.652.88.907-3.55-.228-.365A9.567 9.567 0 012.4 12C2.4 6.698 6.698 2.4 12 2.4S21.6 6.698 21.6 12 17.302 21.6 12 21.6z"/>
              </svg>
              {unread}
            </span>
          )}
          {lead.tarefas_pendentes > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
              background: '#FEF3E2', color: '#C87F1B',
            }}>
              <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              {lead.tarefas_pendentes}
            </span>
          )}
          {lead.total_notas > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
              background: '#F0EDE4', color: '#8A977F',
            }}>
              <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              {lead.total_notas}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
