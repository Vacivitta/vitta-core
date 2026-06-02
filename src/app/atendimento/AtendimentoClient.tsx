'use client'

import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { LeadKanban, FunnelWithStages, Profile, LeadTask } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import LeadModal from '@/components/leads/LeadModal'
import QuickLeadForm from '@/components/leads/QuickLeadForm'

type Channel = 'clinica' | 'meuwhats'

interface Props {
  funnels: FunnelWithStages[]
  profiles: Profile[]
  currentUser: Profile
  initialNumero?: string | null
}

const WA_URL = 'https://web.whatsapp.com'
const fmtCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export default function AtendimentoClient({ funnels, profiles, currentUser, initialNumero }: Props) {
  const supabase = createClient()

  const [channel, setChannel] = useState<Channel>('clinica')

  // Popup window references + open state
  const clinicaWinRef  = useRef<Window | null>(null)
  const meuwhatsWinRef = useRef<Window | null>(null)
  const [clinicaOpen,   setClinicaOpen]   = useState(false)
  const [meuwhatsOpen,  setMeuwhatsOpen]  = useState(false)
  const [clinicaBlocked,  setClinicaBlocked]  = useState(false)
  const [meuwhatsBlocked, setMeuwhatsBlocked] = useState(false)

  // Right panel — manual lead search
  const [searchQuery, setSearchQuery]     = useState(initialNumero ?? '')
  const [searchResults, setSearchResults] = useState<LeadKanban[]>([])
  const [searching, setSearching]         = useState(false)
  const [selectedLead, setSelectedLead]   = useState<LeadKanban | null>(null)
  const [latestNote, setLatestNote]       = useState<string | null>(null)
  const [pendingTasks, setPendingTasks]   = useState<LeadTask[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Modals
  const [modalLead, setModalLead]         = useState<LeadKanban | null | undefined>(undefined)
  const [showQuickForm, setShowQuickForm] = useState(false)

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Poll window state every second ───────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setClinicaOpen(!!(clinicaWinRef.current && !clinicaWinRef.current.closed))
      setMeuwhatsOpen(!!(meuwhatsWinRef.current && !meuwhatsWinRef.current.closed))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // ── Debounced lead search ─────────────────────────────────────────────────────
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    const q = searchQuery.trim()
    if (!q) { setSearchResults([]); setSelectedLead(null); return }

    searchTimerRef.current = setTimeout(async () => {
      setSearching(true)
      setSelectedLead(null)
      const digits = q.replace(/\D/g, '')
      const isPhone = digits.length >= 6

      const base = supabase.from('leads_kanban').select('*').eq('arquivado', false).limit(8).order('nome')
      const { data } = isPhone
        ? await base.ilike('telefone', `%${digits}%`)
        : await base.or(`nome.ilike.%${q}%,sobrenome.ilike.%${q}%`)

      setSearchResults((data ?? []) as LeadKanban[])
      setSearching(false)
    }, 300)

    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load selected lead detail ─────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedLead) { setLatestNote(null); setPendingTasks([]); return }
    setLoadingDetail(true)
    void Promise.all([
      supabase.from('lead_notes').select('conteudo').eq('lead_id', selectedLead.id)
        .order('created_at', { ascending: false }).limit(1),
      supabase.from('lead_tasks').select('*').eq('lead_id', selectedLead.id).eq('concluida', false)
        .order('data_limite', { nullsFirst: false }),
    ]).then(([{ data: notes }, { data: tasks }]) => {
      setLatestNote(notes?.[0]?.conteudo ?? null)
      setPendingTasks((tasks ?? []) as LeadTask[])
      setLoadingDetail(false)
    })
  }, [selectedLead]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Window open helpers ───────────────────────────────────────────────────────
  function openClinica() {
    const w = window.open(WA_URL, 'whatsapp-clinica', 'width=1100,height=720,left=200,top=80')
    if (!w) { setClinicaBlocked(true); return }
    setClinicaBlocked(false)
    clinicaWinRef.current = w
    setClinicaOpen(true)
  }

  function openMeuWhats() {
    const w = window.open(WA_URL, 'whatsapp-meu', 'width=1100,height=720,left=200,top=80')
    if (!w) { setMeuwhatsBlocked(true); return }
    setMeuwhatsBlocked(false)
    meuwhatsWinRef.current = w
    setMeuwhatsOpen(true)
  }

  function focusClinica() {
    if (clinicaWinRef.current && !clinicaWinRef.current.closed) clinicaWinRef.current.focus()
  }

  function focusMeuWhats() {
    if (meuwhatsWinRef.current && !meuwhatsWinRef.current.closed) meuwhatsWinRef.current.focus()
  }

  const defaultStage = funnels[0]?.stages[0]

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="flex flex-1 overflow-hidden">

        {/* ════ MAIN AREA — WhatsApp launcher ════ */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-gray-50">
          <ChannelTabs channel={channel} onSelect={setChannel} />

          <div className="flex-1 flex items-center justify-center p-8">
            {channel === 'clinica' ? (
              <WhatsAppCard
                title="WhatsApp Web da Clínica"
                instruction="Clique para abrir o WhatsApp Web em uma janela separada. Escaneie o QR Code com o celular do número da clínica na primeira vez."
                windowOpen={clinicaOpen}
                popupBlocked={clinicaBlocked}
                onOpen={openClinica}
                onFocus={focusClinica}
              />
            ) : (
              <WhatsAppCard
                title="Meu WhatsApp"
                instruction="Clique para abrir o WhatsApp Web em uma janela separada. Escaneie o QR Code com o seu WhatsApp pessoal na primeira vez."
                windowOpen={meuwhatsOpen}
                popupBlocked={meuwhatsBlocked}
                onOpen={openMeuWhats}
                onFocus={focusMeuWhats}
              />
            )}
          </div>
        </div>

        {/* ════ RIGHT PANEL — manual lead search ════ */}
        <RightPanel
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searching={searching}
          searchResults={searchResults}
          selectedLead={selectedLead}
          loadingDetail={loadingDetail}
          latestNote={latestNote}
          pendingTasks={pendingTasks}
          onSelectLead={setSelectedLead}
          onOpenLead={lead => setModalLead(lead)}
          onCreateLead={() => setShowQuickForm(true)}
        />
      </div>

      {/* Modals */}
      {modalLead !== undefined && (
        <LeadModal
          lead={modalLead}
          defaultStageId={defaultStage?.id ?? ''}
          funnel={funnels[0] ?? { id: '', nome: '', descricao: null, ativo: true, ordem: 0, created_at: '', stages: [] }}
          allFunnels={funnels}
          profiles={profiles}
          currentUser={currentUser}
          onClose={() => setModalLead(undefined)}
          onSaved={() => setModalLead(undefined)}
        />
      )}

      {showQuickForm && defaultStage && (
        <QuickLeadForm
          defaultStage={defaultStage}
          funnels={funnels}
          profiles={profiles}
          currentUser={currentUser}
          onClose={() => setShowQuickForm(false)}
          onCreated={() => setShowQuickForm(false)}
        />
      )}
    </>
  )
}

// ─── WhatsAppCard ─────────────────────────────────────────────────────────────

interface WhatsAppCardProps {
  title: string
  instruction: string
  windowOpen: boolean
  popupBlocked: boolean
  onOpen: () => void
  onFocus: () => void
}

function WhatsAppCard({ title, instruction, windowOpen, popupBlocked, onOpen, onFocus }: WhatsAppCardProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 max-w-sm w-full flex flex-col items-center gap-6 text-center">
      {/* WhatsApp logo */}
      <div className="w-20 h-20 rounded-full bg-[#25D366] flex items-center justify-center shadow-md">
        <svg viewBox="0 0 24 24" className="w-11 h-11 fill-white">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      </div>

      {/* Title + instruction */}
      <div>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-500 mt-2 leading-relaxed">{instruction}</p>
      </div>

      {/* Status badge */}
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
        windowOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
      }`}>
        <div className={`w-2 h-2 rounded-full shrink-0 ${
          windowOpen ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'
        }`} />
        {windowOpen ? 'Janela aberta' : 'Clique para abrir'}
      </div>

      {/* Popup blocked warning */}
      {popupBlocked && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700 text-left w-full">
          <strong>Popup bloqueado.</strong> Permita popups para este site nas configurações do navegador e tente novamente.
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-2.5 w-full">
        <button
          onClick={onOpen}
          className="w-full py-3 bg-[#25D366] hover:bg-[#1ebe5d] text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Abrir WhatsApp Web
        </button>

        {windowOpen && (
          <button
            onClick={onFocus}
            className="w-full py-2.5 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors text-sm flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
            </svg>
            Trazer para frente
          </button>
        )}
      </div>
    </div>
  )
}

// ─── ChannelTabs ──────────────────────────────────────────────────────────────

function ChannelTabs({ channel, onSelect }: { channel: Channel; onSelect: (c: Channel) => void }) {
  return (
    <div className="flex shrink-0 border-b border-gray-200 bg-white">
      <TabBtn
        label="Clínica"
        active={channel === 'clinica'}
        color="#1D9E75"
        onClick={() => onSelect('clinica')}
        icon={
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        }
      />
      <TabBtn
        label="Meu WhatsApp"
        active={channel === 'meuwhats'}
        color="#185FA5"
        onClick={() => onSelect('meuwhats')}
        icon={
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        }
      />
    </div>
  )
}

function TabBtn({ label, active, color, onClick, icon }: {
  label: string; active: boolean; color: string; onClick: () => void; icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 flex-1 py-3 text-xs font-semibold border-b-2 transition-colors justify-center ${
        active ? '' : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
      style={active ? { color, borderColor: color } : {}}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
      {label}
    </button>
  )
}

// ─── RightPanel ───────────────────────────────────────────────────────────────

interface RightPanelProps {
  searchQuery: string
  onSearchChange: (q: string) => void
  searching: boolean
  searchResults: LeadKanban[]
  selectedLead: LeadKanban | null
  loadingDetail: boolean
  latestNote: string | null
  pendingTasks: LeadTask[]
  onSelectLead: (lead: LeadKanban | null) => void
  onOpenLead: (lead: LeadKanban) => void
  onCreateLead: () => void
}

function RightPanel({
  searchQuery, onSearchChange, searching, searchResults,
  selectedLead, loadingDetail, latestNote, pendingTasks,
  onSelectLead, onOpenLead, onCreateLead,
}: RightPanelProps) {
  const hasQuery = searchQuery.trim().length > 0

  return (
    <div className="w-[280px] shrink-0 flex flex-col bg-white border-l border-gray-200 overflow-hidden">
      {/* Search header */}
      <div className="px-3 py-3 border-b border-gray-100 shrink-0">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Paciente / Lead</p>
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nome ou telefone..."
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 text-xs border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
          />
          {hasQuery && (
            <button
              onClick={() => { onSearchChange(''); onSelectLead(null) }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Searching spinner */}
        {searching && (
          <div className="flex items-center justify-center py-10">
            <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        )}

        {/* No results */}
        {!searching && !selectedLead && hasQuery && searchResults.length === 0 && (
          <div className="text-center py-10 px-4 space-y-3">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600">Nenhum lead encontrado</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Tente outro nome ou número</p>
            </div>
            <button
              onClick={onCreateLead}
              className="w-full py-2 text-xs font-medium text-white bg-blue-500 rounded-xl hover:bg-blue-600 transition-colors"
            >
              + Criar lead
            </button>
          </div>
        )}

        {/* Search results list */}
        {!searching && !selectedLead && searchResults.length > 0 && (
          <div>
            {searchResults.map(lead => (
              <button
                key={lead.id}
                onClick={() => onSelectLead(lead)}
                className="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-xs font-bold text-blue-600">
                  {lead.nome[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900 truncate">
                    {lead.nome}{lead.sobrenome ? ` ${lead.sobrenome}` : ''}
                  </p>
                  <p className="text-[11px] text-gray-400 truncate">{lead.telefone ?? 'Sem telefone'}</p>
                  {lead.stage_nome && (
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full inline-block mt-0.5"
                      style={{ backgroundColor: `${lead.stage_cor}22`, color: lead.stage_cor ?? '#64748b' }}
                    >
                      {lead.stage_nome}
                    </span>
                  )}
                </div>
                <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        )}

        {/* Selected lead detail */}
        {selectedLead && (
          <div className="px-4 py-3 space-y-4">
            <button
              onClick={() => onSelectLead(null)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Voltar à busca
            </button>

            {loadingDetail ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
              </div>
            ) : (
              <>
                {/* Lead identity */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-sm font-bold text-blue-600">
                    {selectedLead.nome[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {selectedLead.nome}{selectedLead.sobrenome ? ` ${selectedLead.sobrenome}` : ''}
                    </p>
                    {selectedLead.stage_nome && (
                      <span
                        className="text-[11px] font-medium px-2 py-0.5 rounded-full inline-block mt-0.5"
                        style={{ backgroundColor: `${selectedLead.stage_cor}22`, color: selectedLead.stage_cor ?? '#64748b' }}
                      >
                        {selectedLead.stage_nome}
                      </span>
                    )}
                  </div>
                </div>

                {selectedLead.responsavel_nome && (
                  <PanelRow label="Responsável">
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center">
                        <span className="text-[8px] font-bold text-blue-600">
                          {selectedLead.responsavel_nome[0]?.toUpperCase()}
                        </span>
                      </div>
                      <span className="text-xs text-gray-700">{selectedLead.responsavel_nome}</span>
                    </div>
                  </PanelRow>
                )}

                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Contato</p>
                  {selectedLead.telefone && (
                    <PanelRow label="Telefone"><span className="text-xs text-gray-700">{selectedLead.telefone}</span></PanelRow>
                  )}
                  {selectedLead.email && (
                    <PanelRow label="E-mail"><span className="text-xs text-blue-500 truncate">{selectedLead.email}</span></PanelRow>
                  )}
                  {!selectedLead.telefone && !selectedLead.email && (
                    <p className="text-xs text-gray-400 italic">Sem contato cadastrado</p>
                  )}
                </div>

                {(selectedLead.valor_proposta != null || selectedLead.valor_negociado != null) && (
                  <PanelRow label="Valor">
                    <span className="text-xs font-semibold text-emerald-600">
                      {fmtCurrency.format(selectedLead.valor_negociado ?? selectedLead.valor_proposta ?? 0)}
                    </span>
                  </PanelRow>
                )}

                {latestNote && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Última anotação</p>
                    <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                      <p className="text-xs text-gray-700 line-clamp-3">{latestNote}</p>
                    </div>
                  </div>
                )}

                {pendingTasks.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                      Tarefas pendentes ({pendingTasks.length})
                    </p>
                    <div className="space-y-1.5">
                      {pendingTasks.slice(0, 3).map(task => {
                        const overdue = task.data_limite && new Date(task.data_limite) < new Date()
                        return (
                          <div key={task.id} className="flex items-start gap-2 text-xs">
                            <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${overdue ? 'bg-red-400' : 'bg-amber-400'}`} />
                            <div className="min-w-0">
                              <p className="text-gray-800 truncate">{task.titulo}</p>
                              {task.data_limite && (
                                <p className={`text-[10px] ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
                                  {format(new Date(task.data_limite), "d MMM 'às' HH:mm", { locale: ptBR })}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => onOpenLead(selectedLead)}
                  className="w-full py-2 text-xs font-medium text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-50 transition-colors"
                >
                  Ver card completo →
                </button>
              </>
            )}
          </div>
        )}

        {/* Empty state */}
        {!hasQuery && !selectedLead && !searching && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <p className="text-xs font-medium text-gray-500">Buscar paciente</p>
            <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
              Pesquise por nome ou telefone para ver o lead no CRM
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PanelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs mb-1.5">
      <span className="text-gray-400 shrink-0 w-20 text-right leading-5">{label}</span>
      <div className="flex-1 min-w-0 leading-5">{children}</div>
    </div>
  )
}
