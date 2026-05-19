'use client'

import { useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { LeadKanban, LeadStage, Profile } from '@/types/database'
import { STAGE_ORDER, STAGE_LABELS } from '@/types/database'
import KanbanBoard from '@/components/kanban/KanbanBoard'
import LeadModal from '@/components/leads/LeadModal'
import { createClient } from '@/lib/supabase/client'

interface Props {
  initialLeads: LeadKanban[]
  profiles: Profile[]
  currentUser: Profile
}

interface Filters {
  search: string
  responsavel_id: string
  cidade: string
  profissao: string
  stage: string
}

export default function FunilClient({ initialLeads, profiles, currentUser }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [leads, setLeads] = useState<LeadKanban[]>(initialLeads)
  const [modalLead, setModalLead] = useState<LeadKanban | null | undefined>(undefined) // undefined = closed
  const [defaultStage, setDefaultStage] = useState<LeadStage>('lead')
  const [filters, setFilters] = useState<Filters>({ search: '', responsavel_id: '', cidade: '', profissao: '', stage: '' })
  const [showFilters, setShowFilters] = useState(false)

  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (filters.search) {
        const q = filters.search.toLowerCase()
        const fullName = `${l.nome} ${l.sobrenome ?? ''}`.toLowerCase()
        if (!fullName.includes(q) && !l.profissao?.toLowerCase().includes(q) && !l.cidade?.toLowerCase().includes(q)) return false
      }
      if (filters.responsavel_id && l.responsavel_id !== filters.responsavel_id) return false
      if (filters.cidade && !l.cidade?.toLowerCase().includes(filters.cidade.toLowerCase())) return false
      if (filters.profissao && !l.profissao?.toLowerCase().includes(filters.profissao.toLowerCase())) return false
      if (filters.stage && l.stage !== filters.stage) return false
      return true
    })
  }, [leads, filters])

  const activeFiltersCount = Object.values(filters).filter(Boolean).length

  function handleLeadClick(lead: LeadKanban) {
    setModalLead(lead)
  }

  function handleAddLead(stage: LeadStage) {
    setDefaultStage(stage)
    setModalLead(null) // null = new lead
  }

  async function handleSaved() {
    const { data } = await supabase.from('leads_kanban').select('*').order('ordem').order('created_at')
    if (data) setLeads(data as LeadKanban[])
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const totalLeads = leads.length
  const totalVendidos = leads.filter(l => l.stage === 'vendido').length

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold text-gray-900">Vitta Core</h1>
          <div className="hidden sm:flex items-center gap-2 text-xs text-gray-400">
            <span>{totalLeads} leads</span>
            <span>·</span>
            <span className="text-emerald-600 font-medium">{totalVendidos} vendidos</span>
          </div>
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

          {/* Filters toggle */}
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

          {/* New lead */}
          <button
            onClick={() => handleAddLead('lead')}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors font-medium"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Novo lead
          </button>

          {/* User menu */}
          <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-gray-200">
            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="text-xs font-bold text-blue-600">{currentUser?.full_name?.[0]?.toUpperCase()}</span>
            </div>
            <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-gray-600 transition-colors hidden sm:block">
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* Filters bar */}
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
            value={filters.stage}
            onChange={e => setFilters(f => ({ ...f, stage: e.target.value }))}
            className="text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Todas etapas</option>
            {STAGE_ORDER.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>

          {activeFiltersCount > 0 && (
            <button
              onClick={() => setFilters({ search: '', responsavel_id: '', cidade: '', profissao: '', stage: '' })}
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
          onLeadClick={handleLeadClick}
          onAddLead={handleAddLead}
        />
      </main>

      {/* Modal */}
      {modalLead !== undefined && (
        <LeadModal
          lead={modalLead}
          defaultStage={defaultStage}
          profiles={profiles}
          currentUser={currentUser}
          onClose={() => setModalLead(undefined)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
