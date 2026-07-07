'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import type { Lead, LeadKanban, FunnelStage, FunnelWithStages, Profile } from '@/types/database'
import KanbanBoard from '@/components/kanban/KanbanBoard'
import LeadModal from '@/components/leads/LeadModal'
import QuickLeadForm from '@/components/leads/QuickLeadForm'
import ArchivedLeadsPanel from '@/components/leads/ArchivedLeadsPanel'
import { createClient } from '@/lib/supabase/client'

interface Props {
  initialLeads: LeadKanban[]
  funnels: FunnelWithStages[]
  profiles: Profile[]
  currentUser: Profile
}

function MultiCheckFilter({ label, selected, options, onChange }: {
  label: string
  selected: string[]
  options: { id: string; label: string; color?: string }[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }

  const btnLabel = selected.length === 0
    ? label
    : selected.length === 1
      ? options.find(o => o.id === selected[0])?.label ?? label
      : `${label} (${selected.length})`

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          fontSize: 12, fontWeight: selected.length ? 700 : 500,
          background: selected.length ? 'rgba(153,198,105,0.25)' : 'rgba(255,255,255,0.10)',
          border: `1px solid ${selected.length ? 'rgba(153,198,105,0.5)' : 'rgba(255,255,255,0.16)'}`,
          borderRadius: 999, padding: '5px 12px', color: '#D9E7DA',
          cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
        }}
      >
        {btnLabel}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points={open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
          background: '#1E3323', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          minWidth: 190, maxHeight: 260, overflowY: 'auto', padding: '6px 0',
        }}>
          {options.map(opt => {
            const checked = selected.includes(opt.id)
            return (
              <label
                key={opt.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
                  cursor: 'pointer', fontSize: 12, color: '#D9E7DA',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                  border: checked ? 'none' : '1.5px solid rgba(255,255,255,0.3)',
                  background: checked ? '#99C669' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {checked && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#1E3323" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                {opt.color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: opt.color, flexShrink: 0 }} />}
                <input type="checkbox" checked={checked} onChange={() => toggle(opt.id)} style={{ display: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface Filters {
  search: string
  responsavel_ids: string[]
  cidade: string
  stage_ids: string[]
  tag_ids: string[]
}

export default function FunilClient({ initialLeads, funnels, profiles, currentUser }: Props) {
  const supabase = createClient()

  const [leads, setLeads]                 = useState<LeadKanban[]>(initialLeads)
  const [selectedFunnelId, setSelectedFunnelId] = useState<string>(funnels[0]?.id ?? '')
  const [modalLead, setModalLead]         = useState<LeadKanban | null | undefined>(undefined)
  const [quickFormStage, setQuickFormStage] = useState<FunnelStage | null>(null)
  const [showArchived, setShowArchived]   = useState(false)
  const [filters, setFilters]             = useState<Filters>({
    search:          '',
    responsavel_ids: [],
    cidade:          '',
    stage_ids:       [],
    tag_ids:         [],
  })
  const [showFilters, setShowFilters]     = useState(false)
  const [unitTags, setUnitTags]           = useState<Array<{ id: string; name: string; color: string }>>([])
  const [unreadByLead, setUnreadByLead]         = useState<Record<string, number>>({})
  const [lastMsgByLead, setLastMsgByLead]       = useState<Record<string, string>>({})
  const [convIdByLead, setConvIdByLead]         = useState<Record<string, string>>({})
  const [tagsByLead, setTagsByLead]             = useState<Record<string, Array<{ id: string; name: string; color: string }>>>({})
  const [contactNamesByLead, setContactNamesByLead] = useState<Record<string, string>>({})

  // Carrega conversas (unread + last_message_at + id + tags) e assina atualizações em tempo real
  useEffect(() => {
    void supabase.from('wa_conversations')
      .select('id, lead_id, unread_count, last_message_at, tags:wa_conversation_tags(tag:wa_tags(id,name,color))')
      .not('lead_id', 'is', null)
      .then(({ data }) => {
        if (!data) return
        const unread: Record<string, number> = {}
        const lastMsg: Record<string, string> = {}
        const convIds: Record<string, string> = {}
        const tags: Record<string, Array<{ id: string; name: string; color: string }>> = {}
        for (const row of data) {
          if (!row.lead_id) continue
          convIds[row.lead_id] = row.id
          if (row.unread_count > 0) unread[row.lead_id] = (unread[row.lead_id] ?? 0) + row.unread_count
          if (row.last_message_at) {
            if (!lastMsg[row.lead_id] || row.last_message_at > lastMsg[row.lead_id]) {
              lastMsg[row.lead_id] = row.last_message_at
            }
          }
          const rowTags = ((row.tags ?? []) as unknown as Array<{ tag: { id: string; name: string; color: string } }>)
            .map(t => t.tag).filter(Boolean)
          if (rowTags.length > 0) tags[row.lead_id] = rowTags
        }
        setUnreadByLead(unread)
        setLastMsgByLead(lastMsg)
        setConvIdByLead(convIds)
        setTagsByLead(tags)
      })

    const ch = supabase.channel('funil_wa_unread')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wa_conversations' },
        payload => {
          const conv = payload.new as { lead_id: string | null; unread_count: number; last_message_at: string | null }
          if (!conv.lead_id) return
          setUnreadByLead(prev => {
            const next = { ...prev }
            if (conv.unread_count > 0) next[conv.lead_id!] = conv.unread_count
            else delete next[conv.lead_id!]
            return next
          })
          if (conv.last_message_at) {
            setLastMsgByLead(prev => ({ ...prev, [conv.lead_id!]: conv.last_message_at! }))
          }
        })
      .subscribe()

    const chLeads = supabase.channel('funil_leads_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' },
        () => { void reloadLeads() })
      .subscribe()

    return () => { void supabase.removeChannel(ch); void supabase.removeChannel(chLeads) }
  }, [supabase])

  // Carrega tags disponíveis da unidade
  useEffect(() => {
    void supabase.from('wa_tags').select('id,name,color').order('name')
      .then(({ data }) => { if (data) setUnitTags(data) })
  }, [supabase])

  // Carrega nomes dos contatos vinculados (dependentes/pacientes) para busca
  useEffect(() => {
    void supabase.from('lead_contacts').select('lead_id, nome').then(({ data }) => {
      if (!data) return
      const map: Record<string, string> = {}
      for (const c of data) {
        map[c.lead_id] = map[c.lead_id] ? `${map[c.lead_id]} ${c.nome}` : c.nome
      }
      setContactNamesByLead(map)
    })
  }, [supabase])

  const selectedFunnel = funnels.find(f => f.id === selectedFunnelId) ?? funnels[0]

  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (l.funnel_id !== selectedFunnelId) return false
      if (filters.search) {
        const q = filters.search.toLowerCase()
        const fullName = `${l.nome} ${l.sobrenome ?? ''}`.toLowerCase()
        const contacts = (contactNamesByLead[l.id] ?? '').toLowerCase()
        if (!fullName.includes(q) && !l.profissao?.toLowerCase().includes(q) && !l.cidade?.toLowerCase().includes(q) && !contacts.includes(q)) return false
      }
      if (filters.responsavel_ids.length && !filters.responsavel_ids.includes(l.responsavel_id ?? '')) return false
      if (filters.cidade && !l.cidade?.toLowerCase().includes(filters.cidade.toLowerCase())) return false
      if (filters.stage_ids.length && !filters.stage_ids.includes(l.stage_id)) return false
      if (filters.tag_ids.length) {
        const lt = tagsByLead[l.id]
        if (!lt || !filters.tag_ids.some(tid => lt.some(t => t.id === tid))) return false
      }
      return true
    })
  }, [leads, selectedFunnelId, filters, contactNamesByLead, tagsByLead])

  const activeFiltersCount = (filters.search ? 1 : 0) + (filters.cidade ? 1 : 0) + filters.responsavel_ids.length + filters.stage_ids.length + filters.tag_ids.length

  const totalLeads    = leads.filter(l => l.funnel_id === selectedFunnelId).length
  const totalVendidos = leads.filter(l => l.funnel_id === selectedFunnelId && l.stage_ordem === Math.max(...(selectedFunnel?.stages.map(s => s.ordem) ?? [0])) - 1).length

  async function reloadLeads() {
    const { data } = await supabase
      .from('leads_kanban')
      .select('*')
      .order('stage_ordem')
      .order('ordem')
      .order('created_at')
    if (data) {
      const fresh = data as LeadKanban[]
      setLeads(fresh)
      // Atualiza o modal com os dados frescos sem fechar
      setModalLead(prev => prev ? (fresh.find(l => l.id === prev.id) ?? prev) : prev)
    }
  }

  function handleLeadClick(lead: LeadKanban) {
    setModalLead(lead)
  }

  function handleAddLead(stage: FunnelStage) {
    setQuickFormStage(stage)
  }

  async function handleQuickCreated(lead: Lead, openFull: boolean) {
    await reloadLeads()
    setQuickFormStage(null)
    if (openFull) {
      const { data } = await supabase
        .from('leads_kanban')
        .select('*')
        .eq('id', lead.id)
        .single()
      if (data) setModalLead(data as LeadKanban)
    }
  }

  if (!selectedFunnel) {
    return (
      <div className="flex items-center justify-center flex-1 text-gray-500 text-sm">
        Nenhum funil ativo. Configure funis no painel do Supabase.
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <header style={{ background: '#25402C', padding: '16px 28px' }} className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          {funnels.length > 1 ? (
            <div className="flex items-center gap-1" style={{ background: 'rgba(255,255,255,0.10)', borderRadius: 999, padding: 3 }}>
              {funnels.map(f => (
                <button
                  key={f.id}
                  onClick={() => setSelectedFunnelId(f.id)}
                  style={{
                    fontSize: 12, padding: '4px 12px', borderRadius: 999, border: 'none', cursor: 'pointer', fontWeight: 700,
                    background: f.id === selectedFunnelId ? 'rgba(255,255,255,0.20)' : 'transparent',
                    color: f.id === selectedFunnelId ? '#fff' : '#A8C3AB',
                  }}
                >
                  {f.nome}
                </button>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>Funil da clínica</span>
          )}
          <span className="hidden sm:block" style={{ fontSize: 12, fontWeight: 700, color: '#A8C3AB' }}>{totalLeads} famílias em acompanhamento</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#A8C3AB' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar..."
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              style={{ paddingLeft: 32, paddingRight: 12, paddingBlock: 6, fontSize: 13, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 999, color: '#D9E7DA', outline: 'none', width: 160 }}
            />
          </div>

          <button
            onClick={() => setShowFilters(v => !v)}
            className="flex items-center gap-1.5"
            style={{ fontSize: 13, padding: '6px 14px', borderRadius: 999, border: activeFiltersCount > 0 ? '1px solid #99C669' : '1px solid rgba(255,255,255,0.16)', background: activeFiltersCount > 0 ? 'rgba(153,198,105,0.15)' : 'rgba(255,255,255,0.10)', color: activeFiltersCount > 0 ? '#99C669' : '#D9E7DA', cursor: 'pointer', fontWeight: 700 }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M7 12h10M11 20h2" />
            </svg>
            Filtros
            {activeFiltersCount > 0 && (
              <span style={{ background: '#99C669', color: '#1E3323', fontSize: 10, fontWeight: 800, width: 16, height: 16, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {activeFiltersCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setShowArchived(true)}
            className="flex items-center gap-1.5"
            style={{ fontSize: 13, padding: '6px 14px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.10)', color: '#D9E7DA', cursor: 'pointer', fontWeight: 700 }}
            title="Ver contatos arquivados"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            <span className="hidden sm:inline">Arquivados</span>
          </button>

          <button
            onClick={() => handleAddLead(selectedFunnel.stages[0])}
            className="flex items-center gap-1.5"
            style={{ fontSize: 13, padding: '6px 16px', borderRadius: 999, border: 'none', background: '#99C669', color: '#1E3323', cursor: 'pointer', fontWeight: 900 }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Novo contato
          </button>
        </div>
      </header>

      {/* Barra de filtros */}
      {showFilters && (
        <div style={{ background: '#2D4A35', padding: '8px 28px', borderTop: '1px solid rgba(255,255,255,0.08)' }} className="flex items-center gap-3 shrink-0 flex-wrap">
          <MultiCheckFilter
            label="Responsável"
            selected={filters.responsavel_ids}
            options={profiles.map(p => ({ id: p.id, label: p.full_name }))}
            onChange={ids => setFilters(f => ({ ...f, responsavel_ids: ids }))}
          />

          <input
            type="text"
            placeholder="Cidade..."
            value={filters.cidade}
            onChange={e => setFilters(f => ({ ...f, cidade: e.target.value }))}
            style={{ fontSize: 12, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 999, padding: '5px 12px', color: '#D9E7DA', outline: 'none', width: 120 }}
          />

          <MultiCheckFilter
            label="Etapa"
            selected={filters.stage_ids}
            options={selectedFunnel.stages.map(s => ({ id: s.id, label: s.nome, color: s.cor }))}
            onChange={ids => setFilters(f => ({ ...f, stage_ids: ids }))}
          />

          {unitTags.length > 0 && (
            <MultiCheckFilter
              label="Tag"
              selected={filters.tag_ids}
              options={unitTags.map(t => ({ id: t.id, label: t.name, color: t.color }))}
              onChange={ids => setFilters(f => ({ ...f, tag_ids: ids }))}
            />
          )}

          {activeFiltersCount > 0 && (
            <button
              onClick={() => setFilters({ search: '', responsavel_ids: [], cidade: '', stage_ids: [], tag_ids: [] })}
              style={{ fontSize: 11, color: '#F0C98A', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {/* Kanban */}
      <main className="flex-1 overflow-auto" style={{ background: '#F2EEE1', padding: 16 }}>
        <KanbanBoard
          initialLeads={filteredLeads}
          stages={selectedFunnel.stages}
          onLeadClick={handleLeadClick}
          onAddLead={handleAddLead}
          unreadByLead={unreadByLead}
          lastMsgByLead={lastMsgByLead}
          tagsByLead={tagsByLead}
          onMarkUnread={leadId => {
            const convId = convIdByLead[leadId]
            if (!convId) return
            void fetch('/api/whatsapp/mark-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: convId, unread: true }) })
            setUnreadByLead(prev => ({ ...prev, [leadId]: 1 }))
          }}
        />
      </main>

      {/* Painel de arquivados */}
      {showArchived && (
        <ArchivedLeadsPanel
          funnels={funnels}
          selectedFunnelId={selectedFunnelId}
          onOpenLead={lead => { setShowArchived(false); setModalLead(lead) }}
          onClose={() => setShowArchived(false)}
        />
      )}

      {/* Quick lead form */}
      {quickFormStage && (
        <QuickLeadForm
          defaultStage={quickFormStage}
          funnels={funnels}
          profiles={profiles}
          currentUser={currentUser}
          onClose={() => setQuickFormStage(null)}
          onCreated={handleQuickCreated}
        />
      )}

      {/* Lead modal (existing leads) */}
      {modalLead !== undefined && (
        <LeadModal
          lead={modalLead}
          defaultStageId={selectedFunnel.stages[0]?.id}
          funnel={selectedFunnel}
          allFunnels={funnels}
          profiles={profiles}
          currentUser={currentUser}
          onClose={() => setModalLead(undefined)}
          onSaved={reloadLeads}
        />
      )}
    </div>
  )
}
