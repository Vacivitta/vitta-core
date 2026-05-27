'use client'

import { useState, useRef, useEffect } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import type { Profile, LeadKanban } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SupervisaoConv {
  id: string
  name: string
  phone: string
  preview: string
  time: string
  unread: number
  status: 'active' | 'waiting' | 'bot'
  stage: string | null
  stageColor: string | null
  operador_nome: string
  waiting_minutes: number
}

interface MockMessage {
  id: string
  from: 'contact' | 'me' | 'gestor'
  content: string
  time: string
  operador?: string
}

interface Props {
  currentUser: Profile
  profiles: Profile[]
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_CONVS: SupervisaoConv[] = [
  { id: '1', name: 'Ana Claudia Santos',  phone: '5511999887766', preview: 'Olá, gostaria de saber mais sobre os planos', time: '14:32', unread: 2, status: 'waiting', stage: 'Qualificado',     stageColor: '#3B82F6', operador_nome: 'Maria Santos', waiting_minutes: 45 },
  { id: '2', name: 'Roberto Ferreira',    phone: '5511988776655', preview: 'Ok, vou pensar e te retorno',                 time: '11:15', unread: 0, status: 'active',  stage: 'Proposta',        stageColor: '#F59E0B', operador_nome: 'João Lima',    waiting_minutes: 0  },
  { id: '3', name: 'Maria José Oliveira', phone: '5521977665544', preview: 'Boa tarde! Vi o anúncio de vocês',            time: 'Ontem', unread: 1, status: 'bot',     stage: null,              stageColor: null,      operador_nome: 'Maria Santos', waiting_minutes: 15 },
  { id: '4', name: 'Carlos Eduardo Lima', phone: '5511966554433', preview: 'Qual o valor do plano anual?',                time: 'Ontem', unread: 0, status: 'waiting', stage: 'Primeiro Contato', stageColor: '#8B5CF6', operador_nome: 'Ana Costa',    waiting_minutes: 82 },
  { id: '5', name: 'Patricia Souza',      phone: '5531955443322', preview: '✓✓ Perfeito, muito obrigada!',                time: 'Seg',   unread: 0, status: 'active',  stage: 'Fechado',         stageColor: '#10B981', operador_nome: 'João Lima',    waiting_minutes: 0  },
  { id: '6', name: 'José Costa',          phone: '5511944332211', preview: 'Aguardando a sua confirmação',               time: 'Dom',   unread: 0, status: 'waiting', stage: 'Negociação',      stageColor: '#EF4444', operador_nome: 'Ana Costa',    waiting_minutes: 37 },
]

const MOCK_MSGS: Record<string, MockMessage[]> = {
  '1': [
    { id: 'm1', from: 'contact', content: 'Olá, gostaria de saber mais sobre os planos disponíveis.', time: '14:28' },
    { id: 'm2', from: 'me',      content: 'Oi Ana! Temos planos individuais e empresariais. Qual é o seu interesse?', time: '14:29', operador: 'Maria Santos' },
    { id: 'm3', from: 'contact', content: 'Tenho uma clínica com 5 funcionários.', time: '14:30' },
    { id: 'm4', from: 'contact', content: 'Olá, gostaria de saber mais sobre os planos...', time: '14:32' },
  ],
  '2': [
    { id: 'm1', from: 'me',      content: 'Roberto! Segue a proposta com desconto especial de 20%.', time: '10:45', operador: 'João Lima' },
    { id: 'm2', from: 'contact', content: 'Recebi! Vou analisar com minha sócia.', time: '11:00' },
    { id: 'm3', from: 'contact', content: 'Ok, vou pensar e te retorno', time: '11:15' },
  ],
  '3': [
    { id: 'm1', from: 'contact', content: 'Boa tarde! Gostaria de mais informações.', time: '09:10' },
    { id: 'm2', from: 'me',      content: 'Oi Maria! Boa tarde. Me conta mais sobre o que você precisa!', time: '09:15', operador: 'Maria Santos' },
  ],
  '4': [
    { id: 'm1', from: 'contact', content: 'Olá! Qual o valor do plano anual para clínicas?', time: 'Ontem' },
  ],
  '5': [
    { id: 'm1', from: 'me',      content: 'Patricia, contrato enviado para o seu e-mail.', time: 'Seg 16:00', operador: 'João Lima' },
    { id: 'm2', from: 'contact', content: '✓✓ Perfeito, muito obrigada!', time: 'Seg 16:46' },
  ],
  '6': [
    { id: 'm1', from: 'me',      content: 'José, como ficamos com relação à proposta?', time: 'Dom 10:00', operador: 'Ana Costa' },
    { id: 'm2', from: 'contact', content: 'Aguardando a sua confirmação', time: 'Dom 10:30' },
  ],
}

const STATUS_COLORS = {
  active:  'bg-emerald-100 text-emerald-700',
  waiting: 'bg-amber-100 text-amber-700',
  bot:     'bg-purple-100 text-purple-700',
}
const STATUS_LABELS = { active: 'Ativo', waiting: 'Aguardando', bot: 'Bot' }

// ─── Component ────────────────────────────────────────────────────────────────

export default function SupervisaoClient({ currentUser, profiles }: Props) {
  const supabase = createClient()

  const [selectedId,    setSelectedId]    = useState<string | null>(null)
  const [search,        setSearch]        = useState('')
  const [localConvs,    setLocalConvs]    = useState<SupervisaoConv[]>(MOCK_CONVS)
  const [localMsgs,     setLocalMsgs]     = useState<Record<string, MockMessage[]>>(MOCK_MSGS)
  const [newMessage,    setNewMessage]    = useState('')
  const [linkedLead,    setLinkedLead]    = useState<LeadKanban | null | undefined>(undefined)
  const [loadingLead,   setLoadingLead]   = useState(false)
  const [transferTarget, setTransferTarget] = useState<string | null>(null)
  const [showTransfer,  setShowTransfer]  = useState(false)

  const msgsEndRef = useRef<HTMLDivElement>(null)

  const selectedConv = localConvs.find(c => c.id === selectedId) ?? null
  const messages     = selectedId ? (localMsgs[selectedId] ?? []) : []

  // Stats
  const stats = {
    total:         localConvs.length,
    aguardando:    localConvs.filter(c => c.status === 'waiting').length,
    sem_resposta:  localConvs.filter(c => c.waiting_minutes > 30).length,
    operadores:    new Set(localConvs.map(c => c.operador_nome)).size,
  }

  // Filtered conversations
  const filtered = localConvs.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.operador_nome.toLowerCase().includes(q)
  })

  // Lead lookup
  useEffect(() => {
    if (!selectedConv) { setLinkedLead(undefined); return }
    const digits = selectedConv.phone.replace(/\D/g, '').slice(-9)
    setLoadingLead(true)
    setLinkedLead(undefined)
    void supabase
      .from('leads_kanban')
      .select('*')
      .ilike('telefone', `%${digits}%`)
      .eq('arquivado', false)
      .limit(1)
      .then(({ data }) => {
        setLinkedLead((data?.[0] as LeadKanban | undefined) ?? null)
        setLoadingLead(false)
      })
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom
  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  function handleSend() {
    if (!newMessage.trim() || !selectedId) return
    const msg: MockMessage = {
      id: `g-${Date.now()}`,
      from: 'gestor',
      content: newMessage.trim(),
      time: format(new Date(), 'HH:mm', { locale: ptBR }),
      operador: `Gestor · ${currentUser.full_name}`,
    }
    setLocalMsgs(prev => ({ ...prev, [selectedId]: [...(prev[selectedId] ?? []), msg] }))
    setNewMessage('')
  }

  function handleAssume() {
    if (!selectedId) return
    setLocalConvs(prev => prev.map(c =>
      c.id === selectedId ? { ...c, operador_nome: `Gestor · ${currentUser.full_name}` } : c
    ))
  }

  function handleTransfer(operadorNome: string) {
    if (!selectedId) return
    setLocalConvs(prev => prev.map(c =>
      c.id === selectedId ? { ...c, operador_nome: operadorNome } : c
    ))
    setShowTransfer(false)
    setTransferTarget(null)
  }

  function waitColor(mins: number) {
    if (mins > 60) return 'text-red-600 bg-red-50'
    if (mins > 30) return 'text-amber-600 bg-amber-50'
    return 'text-gray-400'
  }

  const operadores = profiles.filter(p => p.id !== currentUser.id)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* ── Stats bar ── */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-6 shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-blue-400" />
          <span className="text-xs text-gray-500">Total:</span>
          <span className="text-sm font-bold text-gray-900">{stats.total}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-xs text-gray-500">Aguardando:</span>
          <span className="text-sm font-bold text-amber-700">{stats.aguardando}</span>
        </div>
        {stats.sem_resposta > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-xs text-gray-500">Sem resposta &gt;30 min:</span>
            <span className="text-sm font-bold text-red-600">{stats.sem_resposta}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-xs text-gray-500">Operadores:</span>
          <span className="text-sm font-bold text-gray-900">{stats.operadores}</span>
        </div>
        <div className="ml-auto">
          <span className="text-[11px] text-purple-600 font-semibold bg-purple-50 px-2 py-1 rounded-lg">
            Modo Supervisão
          </span>
        </div>
      </div>

      {/* ── 3-column layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ════ LEFT — Conversations ════ */}
        <div className="w-[300px] shrink-0 flex flex-col bg-gray-50 border-r border-gray-200">

          {/* Search */}
          <div className="px-3 py-2.5 shrink-0 border-b border-gray-200">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Buscar conversa ou operador..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {filtered.map(conv => {
              const isSelected    = conv.id === selectedId
              const waitBadge     = conv.waiting_minutes > 0
              const urgentWait    = conv.waiting_minutes > 60
              const moderateWait  = conv.waiting_minutes > 30 && !urgentWait

              return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition-colors flex items-start gap-2.5 ${
                    isSelected
                      ? 'bg-purple-50 border-l-2 border-l-purple-500'
                      : urgentWait
                        ? 'bg-red-50/50 hover:bg-red-50'
                        : moderateWait
                          ? 'bg-amber-50/40 hover:bg-amber-50'
                          : 'hover:bg-white'
                  }`}
                >
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center shrink-0 text-sm font-bold text-gray-600">
                    {conv.name.split(' ').slice(0, 2).map((w: string) => w[0]).join('')}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-gray-900 truncate">{conv.name}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{conv.time}</span>
                    </div>

                    {/* Operator badge */}
                    <div className="flex items-center gap-1 mt-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-[10px] text-gray-500 truncate">{conv.operador_nome}</span>
                    </div>

                    <p className="text-[11px] text-gray-500 truncate mt-0.5">{conv.preview}</p>

                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
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
                      {waitBadge && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${waitColor(conv.waiting_minutes)}`}>
                          {conv.waiting_minutes}min
                        </span>
                      )}
                    </div>
                  </div>

                  {conv.unread > 0 && (
                    <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 mt-1">
                      <span className="text-[9px] font-bold text-white">{conv.unread}</span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ════ CENTER — Chat ════ */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {selectedConv ? (
            <>
              {/* Conversation header + actions */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-600">
                    {selectedConv.name.split(' ').slice(0, 2).map((w: string) => w[0]).join('')}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{selectedConv.name}</p>
                    <p className="text-[11px] text-gray-400">{selectedConv.phone}</p>
                  </div>
                </div>

                {/* Supervisor actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAssume}
                    className="text-xs px-3 py-1.5 bg-purple-500 text-white rounded-xl hover:bg-purple-600 transition-colors font-medium"
                  >
                    Assumir
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setShowTransfer(v => !v)}
                      className="text-xs px-3 py-1.5 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors font-medium"
                    >
                      Transferir
                    </button>
                    {showTransfer && (
                      <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 w-48 overflow-hidden">
                        {operadores.map(op => (
                          <button
                            key={op.id}
                            onClick={() => handleTransfer(op.full_name)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 transition-colors"
                          >
                            {op.full_name}
                          </button>
                        ))}
                        {operadores.length === 0 && (
                          <p className="px-3 py-2 text-xs text-gray-400">Nenhum operador</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Gestor observing banner */}
              <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 flex items-center gap-2 shrink-0">
                <svg className="w-3.5 h-3.5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span className="text-[11px] text-amber-700 font-medium">
                  Gestor observando · {selectedConv.operador_nome} está atendendo
                </span>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2" style={{ background: '#f0f0f0' }}>
                {messages.map(msg => {
                  const isContact = msg.from === 'contact'
                  const isGestor  = msg.from === 'gestor'
                  return (
                    <div key={msg.id} className={`flex ${isContact ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[70%] ${isContact ? '' : isGestor ? 'items-end' : 'items-end'} flex flex-col`}>
                        {!isContact && msg.operador && (
                          <span className={`text-[10px] mb-0.5 ${isGestor ? 'text-purple-600 font-semibold' : 'text-gray-400'}`}>
                            {isGestor ? `👁 ${msg.operador}` : msg.operador}
                          </span>
                        )}
                        <div className={`px-3 py-2 rounded-2xl text-sm ${
                          isContact
                            ? 'bg-white text-gray-800 rounded-bl-sm'
                            : isGestor
                              ? 'bg-purple-500 text-white rounded-br-sm'
                              : 'bg-[#d9fdd3] text-gray-800 rounded-br-sm'
                        }`}>
                          {msg.content}
                        </div>
                        <span className="text-[10px] text-gray-400 mt-0.5">{msg.time}</span>
                      </div>
                    </div>
                  )
                })}
                <div ref={msgsEndRef} />
              </div>

              {/* Input */}
              <div className="border-t border-gray-200 bg-white px-3 py-2.5 shrink-0">
                <div className="flex items-center gap-1 mb-1.5">
                  <span className="text-[11px] text-purple-600 font-medium bg-purple-50 px-2 py-0.5 rounded-lg">
                    Enviando como Gestor · {currentUser.full_name}
                  </span>
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    value={newMessage}
                    onChange={e => setNewMessage(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                    placeholder="Digite uma mensagem..."
                    rows={1}
                    className="flex-1 resize-none rounded-xl border border-purple-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 max-h-24"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!newMessage.trim()}
                    className="p-2 bg-purple-500 text-white rounded-xl hover:bg-purple-600 disabled:opacity-40 transition-colors shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8" style={{ background: '#f0f0f0' }}>
              <div className="w-16 h-16 rounded-full bg-white shadow-sm flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-500">Selecione uma conversa para supervisionar</p>
              <p className="text-xs text-gray-400 mt-1">Você pode observar, enviar mensagens ou transferir atendimentos</p>
            </div>
          )}
        </div>

        {/* ════ RIGHT — Lead info ════ */}
        <div className="w-[280px] shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col overflow-y-auto">
          {!selectedConv ? (
            <div className="flex-1 flex items-center justify-center p-4">
              <p className="text-xs text-gray-400 text-center">Selecione uma conversa</p>
            </div>
          ) : loadingLead ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-4 bg-gray-200 rounded animate-pulse" />
              ))}
            </div>
          ) : linkedLead ? (
            <div className="p-4 space-y-4">
              {/* Lead header */}
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-purple-600">
                    {linkedLead.nome[0].toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {linkedLead.nome}{linkedLead.sobrenome ? ` ${linkedLead.sobrenome}` : ''}
                  </p>
                  {linkedLead.stage_nome && (
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: `${linkedLead.stage_cor}22`, color: linkedLead.stage_cor ?? '#64748b' }}
                    >
                      {linkedLead.stage_nome}
                    </span>
                  )}
                </div>
              </div>

              {/* Details */}
              {[
                { label: 'Responsável', value: linkedLead.responsavel_nome },
                { label: 'Telefone', value: linkedLead.telefone },
                { label: 'E-mail', value: linkedLead.email },
                { label: 'Profissão', value: linkedLead.profissao },
                { label: 'Cidade', value: linkedLead.cidade },
              ].filter(r => r.value).map(row => (
                <div key={row.label}>
                  <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">{row.label}</p>
                  <p className="text-xs text-gray-700 mt-0.5 truncate">{row.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center">
              <p className="text-xs text-gray-500 font-medium">Lead não vinculado</p>
              <p className="text-[11px] text-gray-400 mt-1">Nenhum lead encontrado para {selectedConv.phone}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
