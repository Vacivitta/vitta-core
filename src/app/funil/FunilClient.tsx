'use client'

import { useState, useMemo, useEffect } from 'react'
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

interface Filters {
  search: string
  responsavel_id: string
  cidade: string
  profissao: string
  stage_id: string
}

export default function FunilClient({ initialLeads, funnels, profiles, currentUser }: Props) {
  const supabase = createClient()

  const [leads, setLeads]                 = useState<LeadKanban[]>(initialLeads)
  const [selectedFunnelId, setSelectedFunnelId] = useState<string>(funnels[0]?.id ?? '')
  const [modalLead, setModalLead]         = useState<LeadKanban | null | undefined>(undefined)
  const [quickFormStage, setQuickFormStage] = useState<FunnelStage | null>(null)
  const [showArchived, setShowArchived]   = useState(false)
  const [filters, setFilters]             = useState<Filters>({
    search:         '',
    responsavel_id: '',
    cidade:         '',
    profissao:      '',
    stage_id:       '',
  })
  const [showFilters, setShowFilters]     = useState(false)
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
    return () => { void supabase.removeChannel(ch) }
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
      if (filters.responsavel_id && l.responsavel_id !== filters.responsavel_id) return false
      if (filters.cidade    && !l.cidade?.toLowerCase().includes(filters.cidade.toLowerCase()))       return false
      if (filters.profissao && !l.profissao?.toLowerCase().includes(filters.profissao.toLowerCase())) return false
      if (filters.stage_id  && l.stage_id !== filters.stage_id)                                        return false
      return true
    })
  }, [leads, selectedFunnelId, filters, contactNamesByLead])

  const activeFiltersCount = Object.values(filters).filter(Boolean).length

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
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          {/* Seletor de funil */}
          {funnels.length > 1 ? (
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-0.5">
              {funnels.map(f => (
                <button
                  key={f.id}
                  onClick={() => setSelectedFunnelId(f.id)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${
                    f.id === selectedFunnelId
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {f.nome}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-sm font-semibold text-gray-800">{selectedFunnel.nome}</span>
          )}

          <span className="hidden sm:block text-xs text-gray-400">{totalLeads} contatos</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar..."
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
            />
          </div>

          {/* Filtros */}
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl border transition-colors ${
              activeFiltersCount > 0
                ? 'bg-blue-50 border-blue-300 text-blue-600'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M7 12h10M11 20h2" />
            </svg>
            Filtros
            {activeFiltersCount > 0 && (
              <span className="bg-blue-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {activeFiltersCount}
              </span>
            )}
          </button>

          {/* Arquivados */}
          <button
            onClick={() => setShowArchived(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
            title="Ver contatos arquivados"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            <span className="hidden sm:inline">Arquivados</span>
          </button>

          {/* Novo lead */}
          <button
            onClick={() => handleAddLead(selectedFunnel.stages[0])}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors font-medium"
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
        <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3 shrink-0 flex-wrap">
          <select
            value={filters.responsavel_id}
            onChange={e => setFilters(f => ({ ...f, responsavel_id: e.target.value }))}
            className="text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Todos responsáveis</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>

          <input
            type="text"
            placeholder="Cidade..."
            value={filters.cidade}
            onChange={e => setFilters(f => ({ ...f, cidade: e.target.value }))}
            className="text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
          />

          <input
            type="text"
            placeholder="Profissão..."
            value={filters.profissao}
            onChange={e => setFilters(f => ({ ...f, profissao: e.target.value }))}
            className="text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
          />

          <select
            value={filters.stage_id}
            onChange={e => setFilters(f => ({ ...f, stage_id: e.target.value }))}
            className="text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Todas etapas</option>
            {selectedFunnel.stages.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>

          {activeFiltersCount > 0 && (
            <button
              onClick={() => setFilters({ search: '', responsavel_id: '', cidade: '', profissao: '', stage_id: '' })}
              className="text-xs text-red-500 hover:text-red-700 transition-colors"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {/* Kanban */}
      <main className="flex-1 overflow-auto p-4">
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
