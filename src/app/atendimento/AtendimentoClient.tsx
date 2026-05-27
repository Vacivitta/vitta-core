'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { LeadKanban, FunnelWithStages, Profile, LeadTask } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import LeadModal from '@/components/leads/LeadModal'
import QuickLeadForm from '@/components/leads/QuickLeadForm'

// ─── Types ────────────────────────────────────────────────────────────────────

type Channel   = 'vacivitta' | 'meuwhats'
type ConvFilter = 'all' | 'unread' | 'waiting' | 'bot'
type MsgType   = 'text' | 'audio' | 'image' | 'document'

interface MockConversation {
  id: string; name: string; phone: string
  preview: string; time: string; unread: number
  status: 'active' | 'waiting' | 'bot'
  stage: string | null; stageColor: string | null
}

interface MockMessage {
  id: string; from: 'contact' | 'me'; type: MsgType
  content: string; time: string; fileName?: string
}

interface Props {
  funnels: FunnelWithStages[]
  profiles: Profile[]
  currentUser: Profile
  initialNumero?: string | null
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_CONVS: MockConversation[] = [
  { id: '1', name: 'Ana Claudia Santos',  phone: '5511999887766', preview: 'Olá, gostaria de saber mais sobre os planos',     time: '14:32', unread: 2, status: 'waiting', stage: 'Qualificado',     stageColor: '#3B82F6' },
  { id: '2', name: 'Roberto Ferreira',    phone: '5511988776655', preview: 'Ok, vou pensar e te retorno',                     time: '11:15', unread: 0, status: 'active',  stage: 'Proposta',        stageColor: '#F59E0B' },
  { id: '3', name: 'Maria José Oliveira', phone: '5521977665544', preview: 'Boa tarde! Vi o anúncio de vocês',                time: 'Ontem', unread: 1, status: 'bot',     stage: null,              stageColor: null      },
  { id: '4', name: 'Carlos Eduardo Lima', phone: '5511966554433', preview: 'Qual o valor do plano anual?',                    time: 'Ontem', unread: 0, status: 'waiting', stage: 'Primeiro Contato', stageColor: '#8B5CF6' },
  { id: '5', name: 'Patricia Souza',      phone: '5531955443322', preview: '✓✓ Perfeito, muito obrigada!',                    time: 'Seg',   unread: 0, status: 'active',  stage: 'Fechado',         stageColor: '#10B981' },
  { id: '6', name: 'José Costa',          phone: '5511944332211', preview: 'Aguardando a sua confirmação',                   time: 'Dom',   unread: 0, status: 'waiting', stage: 'Negociação',      stageColor: '#EF4444' },
]

const MOCK_MSGS: Record<string, MockMessage[]> = {
  '1': [
    { id: 'm1', from: 'contact', type: 'text', content: 'Olá, bom dia! Vi o anúncio de vocês e gostaria de saber mais sobre os planos disponíveis.', time: '14:28' },
    { id: 'm2', from: 'me',      type: 'text', content: 'Oi Ana! Bom dia 😊 Fico feliz com seu interesse. Temos planos individuais e empresariais. Qual seria o seu interesse?', time: '14:29' },
    { id: 'm3', from: 'contact', type: 'text', content: 'Tenho uma clínica com 5 funcionários. Vocês atendem empresas?', time: '14:30' },
    { id: 'm4', from: 'contact', type: 'text', content: 'Olá, gostaria de saber mais sobre os planos...', time: '14:32' },
  ],
  '2': [
    { id: 'm1', from: 'me',      type: 'text',  content: 'Roberto! Segue a proposta conforme conversamos. Plano anual com desconto especial de 20%.', time: '10:45' },
    { id: 'm2', from: 'contact', type: 'text',  content: 'Recebi sim! Vou analisar com minha sócia.', time: '11:00' },
    { id: 'm3', from: 'me',      type: 'audio', content: '', fileName: 'audio_01.ogg', time: '11:05' },
    { id: 'm4', from: 'contact', type: 'text',  content: 'Ok, vou pensar e te retorno', time: '11:15' },
  ],
  '3': [
    { id: 'm1', from: 'contact', type: 'text',  content: 'Boa tarde! Gostaria de mais informações.', time: '09:10' },
    { id: 'm2', from: 'me',      type: 'text',  content: 'Oi Maria! Boa tarde 😊 Terei prazer em ajudar. Me conta mais sobre o que você precisa!', time: '09:15' },
    { id: 'm3', from: 'contact', type: 'image', content: '', fileName: 'foto_clinica.jpg', time: '09:20' },
    { id: 'm4', from: 'contact', type: 'text',  content: 'Boa tarde! Vi o anúncio de vocês', time: 'Ontem' },
  ],
  '4': [
    { id: 'm1', from: 'contact', type: 'text', content: 'Olá! Qual o valor do plano anual para clínicas?', time: 'Ontem' },
  ],
  '5': [
    { id: 'm1', from: 'me',      type: 'text',     content: 'Patricia, tudo certo! Contrato enviado para o seu e-mail. 📄', time: 'Seg 16:00' },
    { id: 'm2', from: 'contact', type: 'document', content: '', fileName: 'contrato_assinado.pdf', time: 'Seg 16:45' },
    { id: 'm3', from: 'contact', type: 'text',     content: '✓✓ Perfeito, muito obrigada!', time: 'Seg 16:46' },
  ],
  '6': [
    { id: 'm1', from: 'me',      type: 'text', content: 'José, como ficamos com relação à proposta?', time: 'Dom 10:00' },
    { id: 'm2', from: 'contact', type: 'text', content: 'Aguardando a sua confirmação', time: 'Dom 10:30' },
  ],
}

const STATUS_LABELS: Record<MockConversation['status'], string> = {
  active: 'Ativo', waiting: 'Aguardando', bot: 'Bot',
}
const STATUS_COLORS: Record<MockConversation['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700',
  waiting: 'bg-amber-100 text-amber-700',
  bot: 'bg-purple-100 text-purple-700',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AtendimentoClient({ funnels, profiles, currentUser, initialNumero }: Props) {
  const router  = useRouter()
  const supabase = createClient()

  // layout state
  const [channel,      setChannel]      = useState<Channel>('vacivitta')
  const [convFilter,   setConvFilter]   = useState<ConvFilter>('all')
  const [search,       setSearch]       = useState('')
  const [selectedId,   setSelectedId]   = useState<string | null>(null)
  const [newMessage,   setNewMessage]   = useState('')
  const [directNumber, setDirectNumber] = useState<string | null>(null)

  // right panel state
  const [linkedLead,    setLinkedLead]    = useState<LeadKanban | null | undefined>(undefined)
  const [loadingLead,   setLoadingLead]   = useState(false)
  const [latestNote,    setLatestNote]    = useState<string | null>(null)
  const [pendingTasks,  setPendingTasks]  = useState<LeadTask[]>([])

  // modal state
  const [modalLead,     setModalLead]     = useState<LeadKanban | null | undefined>(undefined)
  const [showQuickForm, setShowQuickForm] = useState(false)

  // local messages (mock + any typed)
  const [localMsgs, setLocalMsgs] = useState<Record<string, MockMessage[]>>(MOCK_MSGS)

  const msgsEndRef = useRef<HTMLDivElement>(null)

  const selectedConv = MOCK_CONVS.find(c => c.id === selectedId) ?? null
  const messages     = selectedId ? (localMsgs[selectedId] ?? []) : []

  // ── Resolve initialNumero on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!initialNumero) return
    const incoming = initialNumero.replace(/\D/g, '').slice(-9)
    const match = MOCK_CONVS.find(c => c.phone.replace(/\D/g, '').slice(-9) === incoming)
    if (match) {
      setSelectedId(match.id)
    } else {
      setDirectNumber(incoming)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lookup lead by phone when conversation changes ──────────────────────────
  useEffect(() => {
    const lookupPhone = selectedConv?.phone ?? (directNumber ? `00${directNumber}` : null)
    if (!lookupPhone) { setLinkedLead(undefined); setLatestNote(null); setPendingTasks([]); return }

    const digits = lookupPhone.replace(/\D/g, '').slice(-9)
    setLoadingLead(true)
    setLinkedLead(undefined)
    setLatestNote(null)
    setPendingTasks([])

    void supabase
      .from('leads_kanban')
      .select('*')
      .ilike('telefone', `%${digits}%`)
      .eq('arquivado', false)
      .limit(1)
      .then(({ data }) => {
        const lead = data?.[0] as LeadKanban | undefined ?? null
        setLinkedLead(lead)
        setLoadingLead(false)
        if (lead) {
          void supabase.from('lead_notes').select('conteudo').eq('lead_id', lead.id)
            .order('created_at', { ascending: false }).limit(1)
            .then(({ data: n }) => setLatestNote(n?.[0]?.conteudo ?? null))
          void supabase.from('lead_tasks').select('*').eq('lead_id', lead.id).eq('concluida', false)
            .order('data_limite', { nullsFirst: false })
            .then(({ data: t }) => setPendingTasks((t ?? []) as LeadTask[]))
        }
      })
  }, [selectedId, directNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll messages ────────────────────────────────────────────────────
  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // ── Filter conversations ────────────────────────────────────────────────────
  const filteredConvs = MOCK_CONVS.filter(c => {
    if (search) {
      const q = search.toLowerCase()
      if (!c.name.toLowerCase().includes(q) && !c.phone.includes(q)) return false
    }
    if (convFilter === 'unread')  return c.unread > 0
    if (convFilter === 'waiting') return c.status === 'waiting'
    if (convFilter === 'bot')     return c.status === 'bot'
    return true
  })

  // ── Send message ────────────────────────────────────────────────────────────
  function handleSend() {
    if (!newMessage.trim() || !selectedId) return
    const msg: MockMessage = {
      id: `local-${Date.now()}`,
      from: 'me',
      type: 'text',
      content: newMessage.trim(),
      time: format(new Date(), 'HH:mm'),
    }
    setLocalMsgs(prev => ({ ...prev, [selectedId]: [...(prev[selectedId] ?? []), msg] }))
    setNewMessage('')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const defaultStage = funnels[0]?.stages[0]

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="flex flex-1 overflow-hidden">

        {channel === 'meuwhats' ? (
          /* WhatsApp Web mode: left+center = iframe, right = lead panel */
          <>
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Channel tabs still visible at top */}
              <ChannelTabs channel={channel} onSelect={setChannel} />
              <iframe
                src="https://web.whatsapp.com"
                className="flex-1 w-full border-none"
                title="WhatsApp Web"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              />
            </div>
            <RightPanel
              loading={loadingLead}
              linkedLead={linkedLead}
              latestNote={latestNote}
              pendingTasks={pendingTasks}
              funnels={funnels}
              profiles={profiles}
              currentUser={currentUser}
              onOpenLead={lead => setModalLead(lead)}
              onCreateLead={() => setShowQuickForm(true)}
            />
          </>
        ) : (
          /* Seja Vacivitta mode: 3 columns */
          <>
            {/* ════ LEFT PANEL ════ */}
            <div className="w-[280px] shrink-0 flex flex-col bg-gray-50 border-r border-gray-200">

              {/* Channel tabs */}
              <ChannelTabs channel={channel} onSelect={setChannel} />

              {/* Search */}
              <div className="px-3 pb-2 shrink-0">
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Buscar por nome ou número..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-1 px-3 pb-2 overflow-x-auto shrink-0">
                {(['all', 'unread', 'waiting', 'bot'] as ConvFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setConvFilter(f)}
                    className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap font-medium transition-colors ${
                      convFilter === f ? 'bg-blue-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {{ all: 'Todas', unread: 'Não lidas', waiting: 'Aguardando', bot: 'Bot' }[f]}
                  </button>
                ))}
              </div>

              {/* Conversation list */}
              <div className="flex-1 overflow-y-auto">
                {filteredConvs.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-8 px-4">Nenhuma conversa encontrada</p>
                )}
                {filteredConvs.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedId(conv.id)}
                    className={`w-full text-left px-3 py-3 border-b border-gray-100 transition-colors flex items-start gap-2.5 ${
                      selectedId === conv.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-white'
                    }`}
                  >
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center shrink-0 text-sm font-bold text-gray-600">
                      {conv.name.split(' ').slice(0, 2).map(w => w[0]).join('')}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-gray-900 truncate">{conv.name}</span>
                        <span className="text-[10px] text-gray-400 shrink-0">{conv.time}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 truncate mt-0.5">{conv.preview}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        {conv.stage && (
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: `${conv.stageColor}22`, color: conv.stageColor ?? '#64748b' }}
                          >
                            {conv.stage}
                          </span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[conv.status]}`}>
                          {STATUS_LABELS[conv.status]}
                        </span>
                      </div>
                    </div>
                    {/* Unread badge */}
                    {conv.unread > 0 && (
                      <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 mt-1">
                        <span className="text-[9px] font-bold text-white">{conv.unread}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* ════ CENTER PANEL ════ */}
            <div className="flex-1 flex flex-col min-w-0 bg-white">
              {selectedConv ? (
                <>
                  {/* Conversation header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0 bg-white">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-600">
                        {selectedConv.name.split(' ').slice(0, 2).map(w => w[0]).join('')}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{selectedConv.name}</p>
                        <p className="text-[11px] text-gray-400">{selectedConv.phone}</p>
                      </div>
                    </div>
                    {/* Action buttons */}
                    <div className="flex items-center gap-1">
                      <ActionIconBtn title="Sugestão IA" icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.476A3.32 3.32 0 0110 18.011V19a2 2 0 11-4 0v-.989a3.32 3.32 0 01-.979-2.335l-.548-.476z" />
                      } />
                      <ActionIconBtn title="Atalhos" icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      } />
                      <ActionIconBtn title="Tags" icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      } />
                      <ActionIconBtn title="Transferir" icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      } />
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2" style={{ background: '#f0f0f0' }}>
                    {messages.map(msg => (
                      <MessageBubble key={msg.id} msg={msg} />
                    ))}
                    <div ref={msgsEndRef} />
                  </div>

                  {/* Input bar */}
                  <div className="border-t border-gray-200 bg-white px-3 py-2.5 shrink-0">
                    <div className="flex items-end gap-2">
                      {/* Attach */}
                      <button className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition-colors shrink-0" title="Anexar">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      </button>
                      {/* Text input */}
                      <textarea
                        value={newMessage}
                        onChange={e => setNewMessage(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                        placeholder="Digite uma mensagem..."
                        rows={1}
                        className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-24"
                      />
                      {/* Atalhos */}
                      <button className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition-colors shrink-0" title="Atalhos (/comando)">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </button>
                      {/* IA */}
                      <button className="text-purple-400 hover:text-purple-600 p-1.5 rounded-xl hover:bg-purple-50 transition-colors shrink-0" title="Sugestão de resposta IA">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.476A3.32 3.32 0 0110 18.011V19a2 2 0 11-4 0v-.989a3.32 3.32 0 01-.979-2.335l-.548-.476z" />
                        </svg>
                      </button>
                      {/* Send */}
                      <button
                        onClick={handleSend}
                        disabled={!newMessage.trim()}
                        className="p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-40 transition-colors shrink-0"
                        title="Enviar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </>
              ) : directNumber ? (
                /* Direct number: no mock conv match — show empty chat with number in header */
                <>
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0 bg-white">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-500">?</div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">+{directNumber}</p>
                      <p className="text-[11px] text-gray-400">Conversa nova</p>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-center" style={{ background: '#f0f0f0' }}>
                    <p className="text-xs text-gray-400">Nenhuma conversa anterior com este número</p>
                  </div>
                  <div className="border-t border-gray-200 bg-white px-3 py-2.5 shrink-0">
                    <div className="flex items-end gap-2">
                      <textarea
                        value={newMessage}
                        onChange={e => setNewMessage(e.target.value)}
                        placeholder={`Enviar mensagem para +${directNumber}...`}
                        rows={1}
                        className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-24"
                      />
                      <button
                        disabled={!newMessage.trim()}
                        className="p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-40 transition-colors shrink-0"
                        title="Enviar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                /* Empty state */
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8" style={{ background: '#f0f0f0' }}>
                  <div className="w-16 h-16 rounded-full bg-white shadow-sm flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-500">Selecione uma conversa</p>
                  <p className="text-xs text-gray-400 mt-1">Escolha um contato para começar a atender</p>
                </div>
              )}
            </div>

            {/* ════ RIGHT PANEL ════ */}
            <RightPanel
              loading={loadingLead}
              linkedLead={linkedLead}
              latestNote={latestNote}
              pendingTasks={pendingTasks}
              funnels={funnels}
              profiles={profiles}
              currentUser={currentUser}
              onOpenLead={lead => setModalLead(lead)}
              onCreateLead={() => setShowQuickForm(true)}
              selectedConv={selectedConv}
            />
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {modalLead !== undefined && (
        <LeadModal
          lead={modalLead}
          defaultStageId={defaultStage?.id ?? ''}
          funnel={funnels[0] ?? { id: '', nome: '', descricao: null, ativo: true, ordem: 0, created_at: '', stages: [] }}
          allFunnels={funnels}
          profiles={profiles}
          currentUser={currentUser}
          onClose={() => setModalLead(undefined)}
          onSaved={() => {
            setModalLead(undefined)
            // re-fetch linked lead
            setSelectedId(prev => { setTimeout(() => setSelectedId(prev), 0); return null })
          }}
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChannelTabs({ channel, onSelect }: { channel: Channel; onSelect: (c: Channel) => void }) {
  return (
    <div className="flex shrink-0 border-b border-gray-200">
      <button
        onClick={() => onSelect('vacivitta')}
        className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
          channel === 'vacivitta'
            ? 'border-[#1D9E75] text-[#1D9E75]'
            : 'border-transparent text-gray-500 hover:text-gray-700'
        }`}
      >
        Seja Vacivitta
      </button>
      <button
        onClick={() => onSelect('meuwhats')}
        className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
          channel === 'meuwhats'
            ? 'border-[#185FA5] text-[#185FA5]'
            : 'border-transparent text-gray-500 hover:text-gray-700'
        }`}
      >
        Meu WhatsApp
      </button>
    </div>
  )
}

function ActionIconBtn({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <button title={title} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
    </button>
  )
}

function MessageBubble({ msg }: { msg: MockMessage }) {
  const isMe = msg.from === 'me'
  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] rounded-xl px-3 py-2 shadow-sm ${isMe ? 'bg-[#d9fdd3]' : 'bg-white'}`}>
        {msg.type === 'text' && (
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{msg.content}</p>
        )}
        {msg.type === 'audio' && (
          <div className="flex items-center gap-2 min-w-[160px]">
            <button className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
              <svg className="w-3.5 h-3.5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
            <div className="flex-1 flex items-center gap-0.5 h-6">
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i} className="w-0.5 bg-gray-300 rounded-full" style={{ height: `${Math.random() * 80 + 20}%` }} />
              ))}
            </div>
            <span className="text-[10px] text-gray-400 shrink-0">0:12</span>
          </div>
        )}
        {msg.type === 'image' && (
          <div className="w-40 h-28 bg-gray-200 rounded-lg flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {msg.type === 'document' && (
          <div className="flex items-center gap-2 min-w-[160px]">
            <div className="w-8 h-10 bg-red-100 rounded flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate">{msg.fileName}</p>
              <p className="text-[10px] text-gray-400">PDF</p>
            </div>
          </div>
        )}
        <p className={`text-[10px] mt-1 ${isMe ? 'text-right text-gray-400' : 'text-gray-400'}`}>
          {msg.time}{isMe && ' ✓✓'}
        </p>
      </div>
    </div>
  )
}

// ─── Right Panel ──────────────────────────────────────────────────────────────

interface RightPanelProps {
  loading: boolean
  linkedLead: LeadKanban | null | undefined
  latestNote: string | null
  pendingTasks: LeadTask[]
  funnels: FunnelWithStages[]
  profiles: Profile[]
  currentUser: Profile
  onOpenLead: (lead: LeadKanban) => void
  onCreateLead: () => void
  selectedConv?: MockConversation | null
}

function RightPanel({ loading, linkedLead, latestNote, pendingTasks, onOpenLead, onCreateLead, selectedConv }: RightPanelProps) {
  const fmtCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <div className="w-[280px] shrink-0 flex flex-col bg-white border-l border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 shrink-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lead no CRM</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!selectedConv ? (
          <div className="text-center py-8">
            <p className="text-xs text-gray-400">Selecione uma conversa para ver o lead vinculado</p>
          </div>
        ) : loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : linkedLead ? (
          <div className="space-y-4">
            {/* Lead identity */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-sm font-bold text-blue-600">
                {linkedLead.nome[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {linkedLead.nome}{linkedLead.sobrenome ? ` ${linkedLead.sobrenome}` : ''}
                </p>
                {linkedLead.stage_nome && (
                  <span
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full inline-block mt-0.5"
                    style={{ backgroundColor: `${linkedLead.stage_cor}22`, color: linkedLead.stage_cor ?? '#64748b' }}
                  >
                    {linkedLead.stage_nome}
                  </span>
                )}
              </div>
            </div>

            {/* Responsável */}
            {linkedLead.responsavel_nome && (
              <PanelRow label="Responsável">
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center">
                    <span className="text-[8px] font-bold text-blue-600">{linkedLead.responsavel_nome[0]?.toUpperCase()}</span>
                  </div>
                  <span className="text-xs text-gray-700">{linkedLead.responsavel_nome}</span>
                </div>
              </PanelRow>
            )}

            {/* Contato */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Contato</p>
              {linkedLead.telefone && <PanelRow label="Telefone"><span className="text-xs text-gray-700">{linkedLead.telefone}</span></PanelRow>}
              {linkedLead.email    && <PanelRow label="E-mail"><span className="text-xs text-blue-500 truncate">{linkedLead.email}</span></PanelRow>}
              {!linkedLead.telefone && !linkedLead.email && <p className="text-xs text-gray-400 italic">Sem contato</p>}
            </div>

            {/* Valor */}
            {(linkedLead.valor_proposta != null || linkedLead.valor_negociado != null) && (
              <PanelRow label="Valor">
                <span className="text-xs font-semibold text-emerald-600">
                  {fmtCurrency.format(linkedLead.valor_negociado ?? linkedLead.valor_proposta ?? 0)}
                </span>
              </PanelRow>
            )}

            {/* Última anotação */}
            {latestNote && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Última anotação</p>
                <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                  <p className="text-xs text-gray-700 line-clamp-3">{latestNote}</p>
                </div>
              </div>
            )}

            {/* Tarefas pendentes */}
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
              onClick={() => onOpenLead(linkedLead)}
              className="w-full py-2 text-xs font-medium text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-50 transition-colors"
            >
              Ver card completo →
            </button>
          </div>
        ) : selectedConv ? (
          <div className="text-center py-6 space-y-3">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600">Lead não encontrado</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Nenhum lead com este número no CRM</p>
            </div>
            <button
              onClick={onCreateLead}
              className="w-full py-2 text-xs font-medium text-white bg-blue-500 rounded-xl hover:bg-blue-600 transition-colors"
            >
              + Criar lead
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function PanelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs mb-1.5">
      <span className="text-gray-400 shrink-0 w-20 text-right leading-5">{label}</span>
      <div className="flex-1 min-w-0 leading-5">{children}</div>
    </div>
  )
}
