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
  lastMsgByLead?: Record<string, string>
  tagsByLead?: Record<string, Array<{ id: string; name: string; color: string }>>
  onMarkUnread?: (leadId: string) => void
}

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })

export default function KanbanColumn({ stage, leads, onLeadClick, onAddLead, unreadByLead = {}, lastMsgByLead = {}, tagsByLead = {}, onMarkUnread }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })

  const totalValue  = leads.reduce((sum, l) => sum + (l.valor_negociado ?? l.valor_proposta ?? (Number(l.valor_orcamentos) || 0)), 0)
  const stageUnread = leads.reduce((sum, l) => sum + (unreadByLead[l.id] ?? 0), 0)

  const sortedLeads = [...leads].sort((a, b) => {
    const ua = unreadByLead[a.id] ?? 0
    const ub = unreadByLead[b.id] ?? 0
    if (ua > 0 && ub === 0) return -1
    if (ub > 0 && ua === 0) return 1
    const ma = lastMsgByLead[a.id] ?? ''
    const mb = lastMsgByLead[b.id] ?? ''
    if (ma || mb) return mb.localeCompare(ma)
    return 0
  })

  return (
    <div className="flex flex-col shrink-0 snap-start" style={{ width: 264, gap: 6 }}>
      {/* Header */}
      <div style={{
        background: '#fff', borderRadius: 10, padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: `2px solid ${stage.cor || '#3E9849'}`,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: stage.cor || '#3E9849',
        }} />
        <span style={{
          fontSize: 13, fontWeight: 700, color: '#1a1a1a', flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {stage.nome}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700, color: stage.cor || '#3E9849',
          background: (stage.cor || '#3E9849') + '15',
          padding: '1px 7px', borderRadius: 6, flexShrink: 0,
        }}>
          {leads.length}
        </span>
        {stageUnread > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
            background: '#25D366', color: '#fff', flexShrink: 0,
          }}>
            {stageUnread}
          </span>
        )}
        {totalValue > 0 && (
          <span style={{ fontSize: 10, fontWeight: 600, color: '#9AA79C', flexShrink: 0 }}>
            {fmt.format(totalValue)}
          </span>
        )}
        <button
          onClick={() => onAddLead(stage)}
          style={{
            width: 22, height: 22, borderRadius: 6, border: '1px solid #E5E5E5',
            background: '#FAFAFA', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
          title="Adicionar contato"
        >
          <svg width="11" height="11" fill="none" stroke="#999" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Drop area */}
      <div
        ref={setNodeRef}
        className="flex-1 min-h-0 flex flex-col gap-1.5 overflow-y-auto"
        style={{
          padding: 2,
          transition: 'background 0.15s',
          borderRadius: isOver ? 10 : 0,
          background: isOver ? 'rgba(62,152,73,0.06)' : 'transparent',
        }}
      >
        <SortableContext items={sortedLeads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {sortedLeads.map(lead => (
            <LeadCard key={lead.id} lead={lead} onClick={() => onLeadClick(lead)} unread={unreadByLead[lead.id] ?? 0} tags={tagsByLead[lead.id]} onMarkUnread={onMarkUnread} lastMsgAt={lastMsgByLead[lead.id]} />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <button
            onClick={() => onAddLead(stage)}
            className="flex-1 flex flex-col items-center justify-center gap-2 py-6 transition-opacity hover:opacity-80"
            style={{ color: '#bbb', border: '1px dashed #ddd', borderRadius: 10, background: 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
          >
            Solte um card aqui
          </button>
        )}
      </div>
    </div>
  )
}
