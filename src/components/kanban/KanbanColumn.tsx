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

  const totalValue  = leads.reduce((sum, l) => sum + (l.valor_negociado ?? l.valor_proposta ?? 0), 0)
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
    <div className="flex flex-col shrink-0 snap-start" style={{ width: 272, gap: 10 }}>
      {/* Header — bloco sólido colorido */}
      <div
        style={{
          borderRadius: 16, padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 9,
          background: stage.cor || '#3E9849',
          boxShadow: `0 6px 16px -8px ${stage.cor}99`,
        }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 900, color: '#fff', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stage.nome}</span>
        <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: '#fff', color: stage.cor || '#3E9849' }}>
          {leads.length}
        </span>
        {stageUnread > 0 && (
          <span className="flex items-center gap-0.5" style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: 'rgba(255,255,255,0.25)', color: '#fff' }}>
            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.565 4.14 1.548 5.876L0 24l6.324-1.524A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.6a9.587 9.587 0 01-4.896-1.34l-.352-.209-3.652.88.907-3.55-.228-.365A9.567 9.567 0 012.4 12C2.4 6.698 6.698 2.4 12 2.4S21.6 6.698 21.6 12 17.302 21.6 12 21.6z"/>
            </svg>
            {stageUnread}
          </span>
        )}
        {totalValue > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.75)' }}>{fmt.format(totalValue)}</span>
        )}
        <button
          onClick={() => onAddLead(stage)}
          style={{ width: 24, height: 24, borderRadius: 999, background: 'rgba(255,255,255,0.25)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          title="Adicionar contato"
        >
          <svg width="12" height="12" fill="none" stroke="#fff" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Drop area */}
      <div
        ref={setNodeRef}
        className="flex-1 min-h-0 flex flex-col gap-2.5 overflow-y-auto"
        style={{
          padding: 2,
          transition: 'background 0.15s',
          borderRadius: isOver ? 16 : 0,
          background: isOver ? 'rgba(62,152,73,0.08)' : 'transparent',
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
            className="flex-1 flex flex-col items-center justify-center gap-2 py-8 transition-opacity hover:opacity-80"
            style={{ color: '#9AA79C', border: '1.5px dashed #D9D4C3', borderRadius: 16, background: 'transparent', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>Espaço livre — solte um card aqui</span>
          </button>
        )}
      </div>
    </div>
  )
}
