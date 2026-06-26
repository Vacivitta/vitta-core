'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { format, isToday, isYesterday, differenceInDays, differenceInHours } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { LeadKanban, FunnelWithStages, Profile, LeadTask, LeadContact } from '@/types/database'
import { displayName } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import LeadModal from '@/components/leads/LeadModal'
import DateTimePicker from '@/components/ui/DateTimePicker'
import QuickLeadForm from '@/components/leads/QuickLeadForm'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WaQueue     { id: string; nome: string; cor: string; auto_assign?: boolean }
interface WaTemplate  { id: string; name: string; content: string; category: 'custom' | 'meta_api'; template_name: string | null; language: string | null }
interface WaQuickReply{ id: string; shortcut: string; content: string }

interface WaConversation {
  id: string; wa_phone: string; wa_contact_name: string | null
  status: 'open' | 'pending' | 'resolved'; unread_count: number
  last_message_at: string | null; lead_id: string | null
  assigned_to: string | null; queue_id: string | null; unit_id: string | null
  profile_picture_url?: string | null
  last_message_content?: string | null
  last_message_direction?: 'inbound' | 'outbound' | null
  lead?: { nome: string; sobrenome: string | null } | null
}

interface WaMessage {
  id: string; direction: 'inbound' | 'outbound'; type: string
  content: string | null; media_url: string | null; media_mime_type: string | null
  template_name: string | null
  status: string; created_at: string; sent_by: string | null
}

interface WaNote {
  id: string; content: string; author_id: string; created_at: string; author_name?: string
}

interface ChatItem {
  kind: 'message' | 'note'; id: string; created_at: string
  message?: WaMessage; note?: WaNote
}

interface LastQuote {
  id: string; status: string; total_calculado: number | null; criado_em: string
}

interface LeadDetail {
  lead:         LeadKanban
  latestNote:   string | null
  tasks:        LeadTask[]
  lastQuote:    LastQuote | null
  stageEntryAt: string | null
  contacts:     LeadContact[]
}

interface Props {
  funnels: FunnelWithStages[]; profiles: Profile[]
  currentUser: Profile; initialNumero?: string | null
}

type ConvStatus = 'open' | 'pending' | 'resolved' | 'all'
type InputMode  = 'text' | 'note'

const STATUS_LABELS: Record<ConvStatus, string> = { all: 'Todas', open: 'Aberta', pending: 'Pendente', resolved: 'Resolvida' }
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open:     { bg: '#E8F7EE', text: '#1D9E75' },
  pending:  { bg: '#FFF8E1', text: '#F57F17' },
  resolved: { bg: '#F1F4F7', text: '#8FA0AF' },
}
const RESOLVE_REASONS: Record<string, string> = {
  completed:   'Atendimento concluído',
  no_response: 'Sem resposta do cliente',
  deal_won:    'Negócio fechado',
  deal_lost:   'Negócio perdido',
  transferred: 'Encaminhado para outro setor',
  other:       'Outro motivo',
}
const fmtCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

// ── Root ──────────────────────────────────────────────────────────────────────

export default function AtendimentoClient({ funnels, profiles, currentUser }: Props) {
  const supabase = createClient()
  const router   = useRouter()

  const [queues,       setQueues]       = useState<WaQueue[]>([])
  const [templates,    setTemplates]    = useState<WaTemplate[]>([])
  const [quickReplies, setQuickReplies] = useState<WaQuickReply[]>([])

  const [conversations, setConversations] = useState<WaConversation[]>([])
  const [convsLoaded,   setConvsLoaded]   = useState(false)
  const [convSearch,    setConvSearch]    = useState('')
  const [filterStatus,  setFilterStatus]  = useState<ConvStatus>('all')
  const [filterQueue,   setFilterQueue]   = useState<string>('all')
  const [filterMine,    setFilterMine]    = useState(false)
  const [selectedConv,  setSelectedConv]  = useState<WaConversation | null>(null)

  const [chatItems,  setChatItems]  = useState<ChatItem[]>([])
  const [msgsLoaded, setMsgsLoaded] = useState(false)
  const [chatInput,         setChatInput]         = useState('')
  const [inputMode,         setInputMode]         = useState<InputMode>('text')
  const [sending,           setSending]           = useState(false)
  const [signatureEnabled,  setSignatureEnabled]  = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('wa_signature') === '1'
  )
  const [soundEnabled, setSoundEnabled] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('wa_sound') !== '0' : true
  )
  const soundEnabledRef = useRef(soundEnabled)
  useEffect(() => { soundEnabledRef.current = soundEnabled }, [soundEnabled])
  const msgsEndRef        = useRef<HTMLDivElement>(null)
  const selectedConvIdRef = useRef<string | null>(null)

  function selectConv(conv: WaConversation | null) {
    selectedConvIdRef.current = conv?.id ?? null
    setSelectedConv(conv)
  }

  const [leadDetail,    setLeadDetail]    = useState<LeadDetail | null>(null)
  const [loadingLead,   setLoadingLead]   = useState(false)
  const [linkSearchQ,   setLinkSearchQ]   = useState('')
  const [linkResults,   setLinkResults]   = useState<LeadKanban[]>([])
  const [linkSearching, setLinkSearching] = useState(false)
  const [showLinkPanel, setShowLinkPanel] = useState(false)
  const linkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [modalLead,       setModalLead]       = useState<LeadKanban | null | undefined>(undefined)
  const [showQuickForm,   setShowQuickForm]   = useState(false)
  const [resolveDialogOpen,   setResolveDialogOpen]   = useState(false)
  const [contextPanelOpen,    setContextPanelOpen]    = useState(true)
  const [transferBanner,      setTransferBanner]      = useState<{ toName: string; toId: string } | null>(null)
  const [newConvOpen,         setNewConvOpen]         = useState(false)

  function toggleSignature() {
    setSignatureEnabled(v => {
      const next = !v
      localStorage.setItem('wa_signature', next ? '1' : '0')
      return next
    })
  }

  function toggleSound() {
    setSoundEnabled(v => {
      const next = !v
      localStorage.setItem('wa_sound', next ? '1' : '0')
      return next
    })
  }

  function playNotificationSound() {
    if (!soundEnabledRef.current) return
    try {
      const ctx = new AudioContext()
      const gain = ctx.createGain()
      gain.connect(ctx.destination)
      // Dois tons curtos — estilo notificação WhatsApp
      ;[0, 0.18].forEach((delay, i) => {
        const osc = ctx.createOscillator()
        osc.connect(gain)
        osc.type = 'sine'
        osc.frequency.value = i === 0 ? 880 : 1100
        gain.gain.setValueAtTime(0.001, ctx.currentTime + delay)
        gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + delay + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.22)
        osc.start(ctx.currentTime + delay)
        osc.stop(ctx.currentTime + delay + 0.22)
      })
    } catch { /* AudioContext bloqueado antes de interação do usuário */ }
  }

  // Subscription global — toca som em qualquer nova mensagem inbound da unidade
  useEffect(() => {
    if (!currentUser.unit_id) return
    const ch = supabase
      .channel('wa_sound_notify')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'wa_messages',
        filter: `unit_id=eq.${currentUser.unit_id}`,
      }, payload => {
        const msg = payload.new as { direction: string }
        if (msg.direction === 'inbound') playNotificationSound()
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, currentUser.unit_id])

  const isOutside24hWindow = useMemo(() => {
    if (!msgsLoaded || chatItems.length === 0) return false
    const msgs = chatItems.filter(i => i.kind === 'message')
    if (msgs.length === 0) return false
    const lastInbound = [...chatItems].reverse().find(i => i.kind === 'message' && i.message?.direction === 'inbound')
    // Sem nenhuma mensagem inbound: janela nunca foi aberta, não há restrição
    if (!lastInbound) return false
    return Date.now() - new Date(lastInbound.created_at).getTime() > 24 * 60 * 60 * 1000
  }, [msgsLoaded, chatItems])

  // ── Load support data ────────────────────────────────────────────────────────
  useEffect(() => {
    void supabase.from('wa_queues').select('id,nome,cor,auto_assign').eq('ativo', true).order('nome')
      .then(({ data }) => setQueues((data ?? []) as WaQueue[]))
    void supabase.from('wa_message_templates').select('id,name,content,category,template_name,language').eq('ativo', true).order('name')
      .then(({ data }) => setTemplates((data ?? []) as WaTemplate[]))
    void supabase.from('wa_quick_replies').select('id,shortcut,content').eq('ativo', true).order('shortcut')
      .then(({ data }) => setQuickReplies((data ?? []) as WaQuickReply[]))
  }, [supabase])

  // ── Load conversations ──────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from('wa_conversations')
      .select('id,wa_phone,wa_contact_name,status,unread_count,last_message_at,lead_id,assigned_to,queue_id,unit_id,profile_picture_url,last_message_content,last_message_direction,lead:leads(nome,sobrenome)')
      .order('last_message_at', { ascending: false, nullsFirst: false }).limit(150)
    const list = (data ?? []) as unknown as WaConversation[]
    // Garante que a conversa aberta não mostre badge de não lidas (race condition)
    const openId = selectedConvIdRef.current
    setConversations(openId ? list.map(c => c.id === openId ? { ...c, unread_count: 0 } : c) : list)
    setConvsLoaded(true)
  }, [supabase])

  useEffect(() => { void loadConversations() }, [loadConversations])

  useEffect(() => {
    const ch = supabase.channel('wa_conv_list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_conversations' },
        () => { void loadConversations() }).subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [supabase, loadConversations])

  // ── Load chat ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedConv) { setChatItems([]); setMsgsLoaded(false); setLeadDetail(null); return }
    setMsgsLoaded(false); setChatItems([])
    void Promise.all([
      supabase.from('wa_messages')
        .select('id,direction,type,content,media_url,media_mime_type,template_name,status,created_at,sent_by')
        .eq('conversation_id', selectedConv.id).order('created_at').limit(200),
      supabase.from('wa_internal_notes').select('id,content,author_id,created_at')
        .eq('conversation_id', selectedConv.id).order('created_at'),
    ]).then(([{ data: msgs }, { data: notes }]) => {
      const items: ChatItem[] = [
        ...(msgs ?? []).map(m => ({ kind: 'message' as const, id: m.id, created_at: m.created_at, message: m as WaMessage })),
        ...(notes ?? []).map(n => ({
          kind: 'note' as const, id: n.id, created_at: n.created_at,
          note: { ...n, author_name: profiles.find(p => p.id === n.author_id)?.full_name ?? 'Agente' } as WaNote,
        })),
      ]
      items.sort((a, b) => a.created_at.localeCompare(b.created_at))
      setChatItems(items); setMsgsLoaded(true)
      void supabase.from('wa_conversations').update({ unread_count: 0 }).eq('id', selectedConv.id)
      setConversations(prev => prev.map(c => c.id === selectedConv.id ? { ...c, unread_count: 0 } : c))
    })
    if (selectedConv.lead_id) void loadLeadDetail(selectedConv.lead_id)
    else setLeadDetail(null)
  }, [selectedConv?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadLeadDetail(leadId: string) {
    setLoadingLead(true)
    const [{ data: lead }, { data: notes }, { data: tasks }, { data: quotes }, { data: stageHistory }, { data: contacts }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).single(),
      supabase.from('lead_notes').select('conteudo').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1),
      supabase.from('lead_tasks').select('*').eq('lead_id', leadId).eq('concluida', false).order('data_limite', { nullsFirst: false }),
      supabase.from('quotes').select('id,status,total_calculado,criado_em').eq('lead_id', leadId).order('criado_em', { ascending: false }).limit(1),
      supabase.from('lead_stage_history').select('created_at').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1),
      supabase.from('lead_contacts').select('*').eq('lead_id', leadId).order('created_at'),
    ])
    if (lead) setLeadDetail({
      lead: lead as LeadKanban,
      latestNote:   notes?.[0]?.conteudo ?? null,
      tasks:        (tasks ?? []) as LeadTask[],
      lastQuote:    (quotes?.[0] ?? null) as LastQuote | null,
      stageEntryAt: stageHistory?.[0]?.created_at ?? null,
      contacts:     (contacts ?? []) as LeadContact[],
    })
    setLoadingLead(false)
  }

  // ── Realtime messages ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedConv) return
    const ch = supabase.channel(`wa_chat_${selectedConv.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_messages', filter: `conversation_id=eq.${selectedConv.id}` },
        payload => {
          const msg = payload.new as WaMessage
          setChatItems(prev => prev.some(i => i.id === msg.id) ? prev : [...prev, { kind: 'message', id: msg.id, created_at: msg.created_at, message: msg }])
          void supabase.from('wa_conversations').update({ unread_count: 0 }).eq('id', selectedConv.id)
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wa_messages', filter: `conversation_id=eq.${selectedConv.id}` },
        payload => {
          const updated = payload.new as WaMessage
          setChatItems(prev => prev.map(item =>
            item.kind === 'message' && item.id === updated.id
              ? { ...item, message: updated }
              : item
          ))
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_internal_notes', filter: `conversation_id=eq.${selectedConv.id}` },
        payload => {
          const n = payload.new as WaNote
          const item: ChatItem = { kind: 'note', id: n.id, created_at: n.created_at, note: { ...n, author_name: profiles.find(p => p.id === n.author_id)?.full_name ?? 'Agente' } }
          setChatItems(prev => prev.some(i => i.id === n.id) ? prev : [...prev, item])
        })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [selectedConv?.id, supabase, profiles]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatItems.length])

  // ── Send / media ─────────────────────────────────────────────────────────────
  async function handleSend() {
    if (!selectedConv || !chatInput.trim() || sending) return
    let text = chatInput.trim()
    if (inputMode === 'text' && signatureEnabled) {
      text = `${displayName(currentUser)}: ${text}`
    }
    setChatInput(''); setSending(true)
    try {
      if (inputMode === 'note') {
        await fetch('/api/whatsapp/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id, content: text }) })
      } else {
        await fetch('/api/whatsapp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id, content: text }) })
        // Atualiza preview imediatamente sem esperar realtime
        const convId = selectedConv.id
        setConversations(prev => prev.map(c => c.id === convId
          ? { ...c, last_message_content: text, last_message_direction: 'outbound' }
          : c))
      }
    } finally { setSending(false) }
  }

  async function handleMediaUpload(file: File) {
    if (!selectedConv) return
    setSending(true)
    try {
      const form = new FormData(); form.append('file', file); form.append('conversation_id', selectedConv.id)
      const res = await fetch('/api/whatsapp/send-media', { method: 'POST', body: form })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        alert(data.error ?? 'Erro ao enviar mídia')
      }
    } catch {
      alert('Erro ao enviar mídia')
    } finally { setSending(false) }
  }

  async function handleTemplateSend(t: WaTemplate) {
    if (!selectedConv) return
    if (t.category === 'custom') { setChatInput(t.content); return }
    setSending(true)
    try {
      await fetch('/api/whatsapp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id, type: 'template', template_name: t.template_name, language: t.language ?? 'pt_BR' }) })
    } finally { setSending(false) }
  }

  async function handleScheduleSend(content: string, scheduledFor: string) {
    if (!selectedConv) return
    await fetch('/api/whatsapp/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id, content, scheduled_for: scheduledFor }) })
    setChatInput('')
  }

  // ── Status ──────────────────────────────────────────────────────────────────
  async function updateStatus(status: 'open' | 'pending' | 'resolved') {
    if (!selectedConv) return
    if (status === 'resolved') { setResolveDialogOpen(true); return }
    await supabase.from('wa_conversations').update({ status }).eq('id', selectedConv.id)
    setSelectedConv(prev => prev ? { ...prev, status } : null)
    setConversations(prev => prev.map(c => c.id === selectedConv.id ? { ...c, status } : c))
  }

  async function confirmResolve(reason: string, note: string) {
    if (!selectedConv) return
    await supabase.from('wa_conversations').update({ status: 'resolved', resolved_reason: reason, resolved_note: note || null, resolved_at: new Date().toISOString() }).eq('id', selectedConv.id)
    setSelectedConv(prev => prev ? { ...prev, status: 'resolved' } : null)
    setConversations(prev => prev.map(c => c.id === selectedConv.id ? { ...c, status: 'resolved' } : c))
    setResolveDialogOpen(false)
    const label = RESOLVE_REASONS[reason] ?? reason
    void fetch('/api/whatsapp/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id, content: `Conversa encerrada — ${label}${note ? '\n' + note : ''}` }) })
  }

  async function assignAgent(profileId: string | null) {
    if (!selectedConv) return
    const previousId = selectedConv.assigned_to
    if (previousId === profileId) return // sem mudança
    await supabase.from('wa_conversations').update({ assigned_to: profileId }).eq('id', selectedConv.id)
    setSelectedConv(prev => prev ? { ...prev, assigned_to: profileId } : null)
    setConversations(prev => prev.map(c => c.id === selectedConv.id ? { ...c, assigned_to: profileId } : c))

    // Registrar no histórico da conversa
    const fromName = profiles.find(p => p.id === previousId)?.full_name ?? 'Sem agente'
    const toName   = profileId ? (profiles.find(p => p.id === profileId)?.full_name ?? 'Agente') : 'Sem agente'
    const byName   = displayName(currentUser)
    const noteText = profileId
      ? `Atendimento transferido para ${toName} (por ${byName})`
      : `Agente removido — era ${fromName} (por ${byName})`
    void fetch('/api/whatsapp/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id, content: noteText }) })

    // Perguntar se quer transferir o lead também
    if (profileId && selectedConv.lead_id) {
      setTransferBanner({ toName, toId: profileId })
    }
  }

  async function transferLeadResponsavel(toId: string) {
    if (!selectedConv?.lead_id) return
    await supabase.from('leads').update({ responsavel_id: toId }).eq('id', selectedConv.lead_id)
    setTransferBanner(null)
    void loadLeadDetail(selectedConv.lead_id)
  }

  async function assignQueue(queueId: string | null) {
    if (!selectedConv) return
    const previousQueue = queues.find(q => q.id === selectedConv.queue_id)
    const nextQueue     = queues.find(q => q.id === queueId)
    if (selectedConv.queue_id === queueId) return
    await supabase.from('wa_conversations').update({ queue_id: queueId }).eq('id', selectedConv.id)
    setSelectedConv(prev => prev ? { ...prev, queue_id: queueId } : null)
    setConversations(prev => prev.map(c => c.id === selectedConv.id ? { ...c, queue_id: queueId } : c))

    const fromLabel = previousQueue?.nome ?? 'Sem fila'
    const toLabel   = nextQueue?.nome     ?? 'Sem fila'
    const noteText  = `Fila alterada: ${fromLabel} → ${toLabel} (por ${displayName(currentUser)})`

    // Nota na conversa WhatsApp
    void fetch('/api/whatsapp/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id, content: noteText }) })

    if (selectedConv.lead_id) {
      const { error: noteErr } = await supabase.from('lead_notes').insert({
        lead_id:  selectedConv.lead_id,
        conteudo: noteText,
        autor_id: currentUser.id,
        unit_id:  currentUser.unit_id ?? null,
      })
      if (noteErr) console.error('[assignQueue] falha ao inserir lead_note:', noteErr)
      void loadLeadDetail(selectedConv.lead_id)
    }

    // Distribuição automática: se a fila destino tem auto_assign, chama o endpoint
    if (queueId && nextQueue?.auto_assign) {
      const res = await fetch('/api/whatsapp/auto-assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: selectedConv.id, queue_id: queueId }),
      })
      if (res.ok) {
        const result = await res.json() as { assigned: boolean; agent_id?: string; agent_name?: string }
        if (result.assigned && result.agent_id) {
          setSelectedConv(prev => prev ? { ...prev, assigned_to: result.agent_id! } : null)
          setConversations(prev => prev.map(c => c.id === selectedConv.id ? { ...c, assigned_to: result.agent_id! } : c))
          const autoNote = `Atribuído automaticamente a ${result.agent_name ?? 'agente'}`
          void fetch('/api/whatsapp/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id, content: autoNote }) })
        }
      }
    }
  }

  // ── Lead link ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (linkTimerRef.current) clearTimeout(linkTimerRef.current)
    const q = linkSearchQ.trim()
    if (!q) { setLinkResults([]); return }
    linkTimerRef.current = setTimeout(async () => {
      setLinkSearching(true)
      const digits = q.replace(/\D/g, '')
      const base = supabase.from('leads').select('*').eq('arquivado', false).limit(6).order('nome')
      const { data } = digits.length >= 6 ? await base.ilike('telefone', `%${digits}%`) : await base.or(`nome.ilike.%${q}%,sobrenome.ilike.%${q}%`)
      setLinkResults((data ?? []) as LeadKanban[]); setLinkSearching(false)
    }, 300)
    return () => { if (linkTimerRef.current) clearTimeout(linkTimerRef.current) }
  }, [linkSearchQ]) // eslint-disable-line react-hooks/exhaustive-deps

  async function linkLeadById(leadId: string) {
    if (!selectedConv) return
    await supabase.from('wa_conversations').update({ lead_id: leadId }).eq('id', selectedConv.id)
    setSelectedConv(prev => prev ? { ...prev, lead_id: leadId } : null)
    setConversations(prev => prev.map(c => c.id === selectedConv.id ? { ...c, lead_id: leadId } : c))
    setShowLinkPanel(false); setLinkSearchQ(''); void loadLeadDetail(leadId)
  }

  async function linkLead(lead: LeadKanban) {
    void linkLeadById(lead.id)
  }

  async function unlinkLead() {
    if (!selectedConv) return
    await supabase.from('wa_conversations').update({ lead_id: null }).eq('id', selectedConv.id)
    setSelectedConv(prev => prev ? { ...prev, lead_id: null } : null)
    setConversations(prev => prev.map(c => c.id === selectedConv.id ? { ...c, lead_id: null } : c))
    setLeadDetail(null)
  }

  async function handleStartConversation(phone: string, unitId: string, templateName: string, language: string, components: object[], registerOptin: boolean, bodyText = '') {
    const res = await fetch('/api/whatsapp/start-conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, unit_id: unitId, template_name: templateName, language, components, register_optin: registerOptin, body_text: bodyText }),
    })
    const data = await res.json() as { conversation_id?: string; error?: string }
    if (!res.ok || !data.conversation_id) throw new Error(data.error ?? 'Erro ao iniciar conversa')
    setNewConvOpen(false)
    await loadConversations()
    const conv = conversations.find(c => c.id === data.conversation_id)
    if (conv) selectConv(conv)
  }

  const filteredConvs = conversations.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    if (filterQueue !== 'all' && c.queue_id !== filterQueue) return false
    if (filterMine && c.assigned_to !== currentUser.id) return false
    const q = convSearch.toLowerCase()
    return !q
      || (c.wa_contact_name ?? c.wa_phone).toLowerCase().includes(q)
      || c.wa_phone.includes(q)
      || (c.lead ? `${c.lead.nome} ${c.lead.sobrenome ?? ''}`.toLowerCase().includes(q) : false)
  })
  const totalUnread  = conversations.reduce((s, c) => s + (c.unread_count ?? 0), 0)
  const defaultStage = funnels[0]?.stages[0]

  return (
    <>
      <div className="flex flex-1 overflow-hidden">
        <ConvList convs={filteredConvs} loaded={convsLoaded} selected={selectedConv} onSelect={selectConv}
          search={convSearch} onSearch={setConvSearch} filterStatus={filterStatus} onFilterStatus={setFilterStatus}
          filterQueue={filterQueue} onFilterQueue={setFilterQueue} queues={queues}
          filterMine={filterMine} onFilterMine={setFilterMine} profiles={profiles} totalUnread={totalUnread}
          onNewConv={() => setNewConvOpen(true)} soundEnabled={soundEnabled} onToggleSound={toggleSound} />

        {/* Chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#F8FAFB', minWidth: 0, position: 'relative' }}>
          {!selectedConv ? <EmptyChatState /> : (
            <>
              <ChatHeader conv={selectedConv} profiles={profiles} queues={queues}
                onStatusChange={updateStatus} onAssignAgent={assignAgent} onAssignQueue={assignQueue}
                contextPanelOpen={contextPanelOpen} onToggleContextPanel={() => setContextPanelOpen(v => !v)} />
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {!msgsLoaded && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}><Spinner size={22} color="#0098DA" /></div>}
                {msgsLoaded && chatItems.length === 0 && <div style={{ textAlign: 'center', color: '#B0BEC9', fontSize: 12, marginTop: 40 }}>Nenhuma mensagem ainda</div>}
                {msgsLoaded && chatItems.map(item => item.kind === 'message'
                  ? <ChatBubble key={item.id} msg={item.message!} unitId={selectedConv?.unit_id ?? null} />
                  : <InternalNoteBubble key={item.id} note={item.note!} />)}
                <div ref={msgsEndRef} />
              </div>
              <ChatInput value={chatInput} onChange={setChatInput} onSend={handleSend}
                onMediaUpload={handleMediaUpload} onTemplateSend={handleTemplateSend} onScheduleSend={handleScheduleSend}
                templates={templates} quickReplies={quickReplies} sending={sending} mode={inputMode} onModeChange={setInputMode}
                unitId={currentUser.unit_id ?? ''}
                onTemplatesReload={() => void supabase.from('wa_message_templates').select('id,name,content,category,template_name,language').eq('ativo', true).order('name').then(({ data }) => setTemplates((data ?? []) as WaTemplate[]))}
                onQuickRepliesReload={() => void supabase.from('wa_quick_replies').select('id,shortcut,content').eq('ativo', true).order('shortcut').then(({ data }) => setQuickReplies((data ?? []) as WaQuickReply[]))}
                isOutside24hWindow={isOutside24hWindow}
                signatureEnabled={signatureEnabled} onToggleSignature={toggleSignature}
                signerName={displayName(currentUser)}
              />
            </>
          )}
          {resolveDialogOpen && <ResolveDialog onConfirm={(r, n) => void confirmResolve(r, n)} onCancel={() => setResolveDialogOpen(false)} />}
          {/* Banner de transferência de lead */}
          {transferBanner && (
            <div style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 150, background: '#0E2C3D', color: '#fff', borderRadius: 12, padding: '12px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', gap: 12, minWidth: 360, maxWidth: 500 }}>
              <p style={{ fontSize: 12, margin: 0, flex: 1, lineHeight: 1.5 }}>
                Transferido para <strong>{transferBanner.toName}</strong>. Atualizar o responsável do contato vinculado também?
              </p>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => setTransferBanner(null)} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, border: '1px solid #ffffff44', borderRadius: 7, cursor: 'pointer', background: 'transparent', color: '#ffffffcc' }}>Não</button>
                <button onClick={() => void transferLeadResponsavel(transferBanner.toId)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, border: 'none', borderRadius: 7, cursor: 'pointer', background: '#0098DA', color: '#fff' }}>Sim</button>
              </div>
            </div>
          )}
        </div>

        {/* Context panel — collapsible */}
        <div style={{
          width: contextPanelOpen ? 280 : 0,
          minWidth: contextPanelOpen ? 280 : 0,
          transition: 'width 0.2s ease, min-width 0.2s ease',
          overflow: 'hidden',
          borderLeft: contextPanelOpen ? '1px solid #F1F4F7' : 'none',
          background: '#fff',
          display: 'flex', flexDirection: 'column',
        }}>
          {contextPanelOpen && (
            !selectedConv ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
                <p style={{ fontSize: 12, color: '#B0BEC9' }}>Selecione uma conversa</p>
              </div>
            ) : loadingLead ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={20} color="#0098DA" /></div>
            ) : leadDetail ? (
              <LeadContextView detail={leadDetail} conv={selectedConv} onOpen={lead => setModalLead(lead)} onUnlink={unlinkLead}
                onCreateQuote={() => router.push('/orcamento')}
                onSchedule={() => router.push('/agenda')} />
            ) : (
              <LinkLeadView showPanel={showLinkPanel} onToggle={() => setShowLinkPanel(v => !v)}
                searchQ={linkSearchQ} onSearch={setLinkSearchQ} results={linkResults} searching={linkSearching}
                onLink={linkLead} onCreate={() => setShowQuickForm(true)} />
            )
          )}
        </div>
      </div>

      {modalLead !== undefined && (
        <LeadModal lead={modalLead} defaultStageId={defaultStage?.id ?? ''}
          funnel={funnels[0] ?? { id: '', nome: '', descricao: null, ativo: true, ordem: 0, created_at: '', stages: [] }}
          allFunnels={funnels} profiles={profiles} currentUser={currentUser}
          onClose={() => setModalLead(undefined)}
          onSaved={() => {
            setModalLead(undefined)
            if (selectedConv?.lead_id) void loadLeadDetail(selectedConv.lead_id)
          }}
          onLeadPatched={patch => {
            setLeadDetail(prev => prev ? { ...prev, lead: { ...prev.lead, ...patch } } : null)
            setModalLead(prev => prev ? { ...prev, ...patch } : prev)
          }} />
      )}
      {showQuickForm && defaultStage && (
        <QuickLeadForm defaultStage={defaultStage} funnels={funnels} profiles={profiles} currentUser={currentUser}
          onClose={() => setShowQuickForm(false)}
          onCreated={(lead) => { setShowQuickForm(false); void linkLeadById(lead.id) }} />
      )}
      {newConvOpen && (
        <NewConversationModal
          unitId={currentUser.unit_id ?? ''}
          onStart={handleStartConversation}
          onClose={() => setNewConvOpen(false)}
        />
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }`}</style>
    </>
  )
}

// ── ResolveDialog ─────────────────────────────────────────────────────────────

function ResolveDialog({ onConfirm, onCancel }: { onConfirm: (r: string, n: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('')
  const [note,   setNote]   = useState('')
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(14,44,61,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 420, maxWidth: '92vw', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0E2C3D', margin: '0 0 4px' }}>Encerrar conversa</h3>
        <p style={{ fontSize: 12, color: '#8FA0AF', margin: '0 0 18px' }}>Selecione o motivo para alimentar o histórico e relatórios.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 14 }}>
          {Object.entries(RESOLVE_REASONS).map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', cursor: 'pointer',
              border: `1.5px solid ${reason === key ? '#0098DA' : '#E8EDF2'}`, borderRadius: 10,
              background: reason === key ? '#F0F8FF' : '#fff', transition: 'all 0.12s' }}>
              <input type="radio" name="resolve_reason" value={key} checked={reason === key} onChange={() => setReason(key)}
                style={{ accentColor: '#0098DA', width: 15, height: 15, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: reason === key ? 700 : 500, color: reason === key ? '#0E2C3D' : '#5A7184' }}>{label}</span>
            </label>
          ))}
        </div>
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Observação adicional (opcional)..." rows={2}
          style={{ width: '100%', resize: 'none', border: '1px solid #E8EDF2', borderRadius: 10, padding: '9px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', background: '#F8FAFB', color: '#0E2C3D' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '10px', fontSize: 13, border: '1px solid #E8EDF2', borderRadius: 10, cursor: 'pointer', background: '#fff', color: '#5A7184', fontWeight: 600 }}>Cancelar</button>
          <button onClick={() => reason && onConfirm(reason, note)} disabled={!reason}
            style={{ flex: 2, padding: '10px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 10,
              cursor: reason ? 'pointer' : 'default', background: reason ? '#0098DA' : '#E8EDF2', color: reason ? '#fff' : '#B0BEC9', transition: 'all 0.15s' }}>
            Encerrar conversa
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ConvList ──────────────────────────────────────────────────────────────────

function ConvList({ convs, loaded, selected, onSelect, search, onSearch, filterStatus, onFilterStatus, filterQueue, onFilterQueue, queues, filterMine, onFilterMine, profiles, totalUnread, onNewConv, soundEnabled, onToggleSound }: {
  convs: WaConversation[]; loaded: boolean; selected: WaConversation | null; onSelect: (c: WaConversation) => void
  search: string; onSearch: (q: string) => void; filterStatus: ConvStatus; onFilterStatus: (s: ConvStatus) => void
  filterQueue: string; onFilterQueue: (q: string) => void; queues: WaQueue[]; filterMine: boolean
  onFilterMine: (v: boolean) => void; profiles: Profile[]; totalUnread: number; onNewConv: () => void
  soundEnabled: boolean; onToggleSound: () => void
}) {
  return (
    <div style={{ width: 300, minWidth: 300, borderRight: '1px solid #F1F4F7', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #F1F4F7', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#8FA0AF', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Conversas</p>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {totalUnread > 0 && <span style={{ background: '#25D366', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 7px' }}>{totalUnread}</span>}
            <button onClick={() => onFilterMine(!filterMine)}
              style={{ padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 6, border: '1px solid', cursor: 'pointer',
                background: filterMine ? '#0098DA' : 'transparent', color: filterMine ? '#fff' : '#8FA0AF', borderColor: filterMine ? '#0098DA' : '#E8EDF2' }}>
              Minhas
            </button>
            <button onClick={onToggleSound} title={soundEnabled ? 'Silenciar notificações' : 'Ativar notificações sonoras'}
              style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #E8EDF2', cursor: 'pointer', background: soundEnabled ? '#F0F8FF' : '#F8FAFB', color: soundEnabled ? '#0098DA' : '#B0BEC9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {soundEnabled ? (
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                </svg>
              ) : (
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                </svg>
              )}
            </button>
            <button onClick={onNewConv} title="Nova conversa"
              style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #E8EDF2', cursor: 'pointer', background: '#F0F8FF', color: '#0098DA', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: '#B0BEC9', pointerEvents: 'none' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="Buscar contato..." value={search} onChange={e => onSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: 28, paddingRight: 8, paddingTop: 6, paddingBottom: 6, fontSize: 12, border: '1px solid #E8EDF2', borderRadius: 8, background: '#F8FAFB', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(['all', 'open', 'pending', 'resolved'] as ConvStatus[]).map(s => (
            <button key={s} onClick={() => onFilterStatus(s)}
              style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 99, border: '1px solid', cursor: 'pointer',
                background: filterStatus === s ? '#0E2C3D' : 'transparent', color: filterStatus === s ? '#fff' : '#8FA0AF', borderColor: filterStatus === s ? '#0E2C3D' : '#E8EDF2' }}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        {queues.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button onClick={() => onFilterQueue('all')} style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 99, border: '1px solid', cursor: 'pointer', background: filterQueue === 'all' ? '#F1F4F7' : 'transparent', color: '#8FA0AF', borderColor: '#E8EDF2' }}>
              Todas filas
            </button>
            {queues.map(q => (
              <button key={q.id} onClick={() => onFilterQueue(q.id)}
                style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 99, border: '1px solid', cursor: 'pointer',
                  background: filterQueue === q.id ? q.cor + '22' : 'transparent', color: filterQueue === q.id ? q.cor : '#8FA0AF', borderColor: filterQueue === q.id ? q.cor : '#E8EDF2' }}>
                {q.nome}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!loaded && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 100 }}><Spinner size={20} color="#0098DA" /></div>}
        {loaded && convs.length === 0 && <div style={{ textAlign: 'center', padding: '32px 16px', color: '#B0BEC9', fontSize: 12 }}>Nenhuma conversa</div>}
        {convs.map(conv => {
          const isSelected = selected?.id === conv.id
          const leadName = conv.lead ? [conv.lead.nome, conv.lead.sobrenome].filter(Boolean).join(' ') : null
          const name = leadName ?? conv.wa_contact_name ?? conv.wa_phone
          const sc   = STATUS_COLORS[conv.status] ?? STATUS_COLORS.open
          const assignee = profiles.find(p => p.id === conv.assigned_to)
          return (
            <button key={conv.id} onClick={() => onSelect(conv)}
              style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #F8FAFB', background: isSelected ? '#F0F8FF' : 'transparent', cursor: 'pointer', transition: 'background 0.1s' }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                {conv.profile_picture_url ? (
                  <img src={conv.profile_picture_url} alt={name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: isSelected ? '#0098DA' : '#E8EDF2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: isSelected ? '#fff' : '#5A7184' }}>{name.slice(0, 2).toUpperCase()}</span>
                  </div>
                )}
                <div style={{ position: 'absolute', bottom: 0, right: 0, width: 8, height: 8, borderRadius: '50%', background: sc.text, border: '1.5px solid #fff' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: conv.unread_count > 0 ? 700 : 600, color: '#0E2C3D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  <span style={{ fontSize: 10, color: '#B0BEC9', flexShrink: 0 }}>{conv.last_message_at ? formatConvTime(conv.last_message_at) : ''}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginTop: 1 }}>
                  <span style={{ fontSize: 11, color: '#8FA0AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {conv.last_message_content
                      ? (conv.last_message_direction === 'outbound' ? `Você: ${conv.last_message_content}` : conv.last_message_content)
                      : (assignee ? `↳ ${displayName(assignee)}` : conv.wa_phone)}
                  </span>
                  {conv.unread_count > 0 && <span style={{ background: '#25D366', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 6px', flexShrink: 0 }}>{conv.unread_count}</span>}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── ChatHeader ────────────────────────────────────────────────────────────────

function ChatHeader({ conv, profiles, queues, onStatusChange, onAssignAgent, onAssignQueue, contextPanelOpen, onToggleContextPanel }: {
  conv: WaConversation; profiles: Profile[]; queues: WaQueue[]
  onStatusChange: (s: 'open' | 'pending' | 'resolved') => void
  onAssignAgent: (id: string | null) => void; onAssignQueue: (id: string | null) => void
  contextPanelOpen: boolean; onToggleContextPanel: () => void
}) {
  const [showStatus, setShowStatus] = useState(false)
  const [showAgent,  setShowAgent]  = useState(false)
  const [showQueue,  setShowQueue]  = useState(false)
  const leadName = conv.lead ? [conv.lead.nome, conv.lead.sobrenome].filter(Boolean).join(' ') : null
  const name = leadName ?? conv.wa_contact_name ?? conv.wa_phone
  const sc   = STATUS_COLORS[conv.status] ?? STATUS_COLORS.open

  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid #F1F4F7', background: '#fff', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
      {conv.profile_picture_url ? (
        <img src={conv.profile_picture_url} alt={name} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#0098DA', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{name.slice(0, 2).toUpperCase()}</span>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#0E2C3D', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
        <p style={{ fontSize: 11, color: '#8FA0AF', margin: 0 }}>{conv.wa_phone}</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        {/* Status */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => { setShowStatus(v => !v); setShowAgent(false); setShowQueue(false) }}
            style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 99, border: 'none', cursor: 'pointer', background: sc.bg, color: sc.text }}>
            {STATUS_LABELS[conv.status as ConvStatus] ?? conv.status} ▾
          </button>
          {showStatus && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', border: '1px solid #E8EDF2', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.10)', zIndex: 50, minWidth: 140, overflow: 'hidden' }}>
              {(['open', 'pending', 'resolved'] as const).map(s => (
                <button key={s} onClick={() => { onStatusChange(s); setShowStatus(false) }}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: conv.status === s ? '#F8FAFB' : '#fff', color: STATUS_COLORS[s].text, display: 'block' }}>
                  {STATUS_LABELS[s as ConvStatus]}
                  {s === 'resolved' && <span style={{ fontSize: 9, color: '#B0BEC9', display: 'block', fontWeight: 400 }}>Requer motivo</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Agent */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => { setShowAgent(v => !v); setShowStatus(false); setShowQueue(false) }}
            style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 99, border: '1px solid #E8EDF2', cursor: 'pointer', background: '#fff', color: '#5A7184' }}>
            {(() => { const p = profiles.find(p => p.id === conv.assigned_to); return p ? displayName(p) : '+ Agente' })()} ▾
          </button>
          {showAgent && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', border: '1px solid #E8EDF2', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.10)', zIndex: 50, minWidth: 160, overflow: 'hidden' }}>
              <button onClick={() => { onAssignAgent(null); setShowAgent(false) }} style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, border: 'none', cursor: 'pointer', background: '#fff', color: '#8FA0AF', display: 'block' }}>Sem agente</button>
              {profiles.map(p => (
                <button key={p.id} onClick={() => { onAssignAgent(p.id); setShowAgent(false) }}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, fontWeight: conv.assigned_to === p.id ? 700 : 400, border: 'none', cursor: 'pointer', background: conv.assigned_to === p.id ? '#F8FAFB' : '#fff', color: '#0E2C3D', display: 'block' }}>
                  {p.full_name}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Queue */}
        {queues.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button onClick={() => { setShowQueue(v => !v); setShowStatus(false); setShowAgent(false) }}
              style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 99, border: '1px solid #E8EDF2', cursor: 'pointer',
                background: queues.find(q => q.id === conv.queue_id)?.cor ? queues.find(q => q.id === conv.queue_id)!.cor + '22' : '#fff',
                color: queues.find(q => q.id === conv.queue_id)?.cor ?? '#8FA0AF' }}>
              {queues.find(q => q.id === conv.queue_id)?.nome ?? 'Fila'} ▾
            </button>
            {showQueue && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', border: '1px solid #E8EDF2', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.10)', zIndex: 50, minWidth: 140, overflow: 'hidden' }}>
                <button onClick={() => { onAssignQueue(null); setShowQueue(false) }} style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, border: 'none', cursor: 'pointer', background: '#fff', color: '#8FA0AF', display: 'block' }}>Sem fila</button>
                {queues.map(q => (
                  <button key={q.id} onClick={() => { onAssignQueue(q.id); setShowQueue(false) }}
                    style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, fontWeight: conv.queue_id === q.id ? 700 : 400, border: 'none', cursor: 'pointer', background: conv.queue_id === q.id ? q.cor + '11' : '#fff', color: q.cor, display: 'block' }}>
                    {q.nome}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Toggle context panel */}
        <button onClick={onToggleContextPanel} title={contextPanelOpen ? 'Recolher painel' : 'Expandir painel'}
          style={{ padding: '5px 7px', border: '1px solid #E8EDF2', borderRadius: 8, background: '#F8FAFB', cursor: 'pointer', lineHeight: 0, color: '#8FA0AF', flexShrink: 0 }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={contextPanelOpen ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── ChatBubble / Media ────────────────────────────────────────────────────────

function ChatBubble({ msg, unitId }: { msg: WaMessage; unitId: string | null }) {
  const isOut = msg.direction === 'outbound'
  const failed = isOut && msg.status === 'failed'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isOut ? 'flex-end' : 'flex-start' }}>
      <div style={{ maxWidth: '70%', padding: '8px 12px', borderRadius: isOut ? '14px 14px 4px 14px' : '14px 14px 14px 4px', background: failed ? '#FEE2E2' : isOut ? '#0098DA' : '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: failed ? '1px solid #FECACA' : 'none' }}>
        <MediaContent msg={msg} isOut={isOut} unitId={unitId} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>
          <span style={{ fontSize: 10, color: failed ? '#B91C1C' : isOut ? '#ffffff99' : '#B0BEC9' }}>{format(new Date(msg.created_at), 'HH:mm')}</span>
          {isOut && <StatusTick status={msg.status} />}
        </div>
      </div>
      {failed && (
        <span style={{ fontSize: 10, color: '#B91C1C', marginTop: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
          <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
          Mensagem não entregue
        </span>
      )}
    </div>
  )
}

function MediaContent({ msg, isOut, unitId }: { msg: WaMessage; isOut: boolean; unitId: string | null }) {
  const tc = isOut ? '#fff' : '#0E2C3D'
  const sc = isOut ? '#ffffffaa' : '#8FA0AF'
  const mediaUrl = (id: string) => `/api/whatsapp/media?id=${id}${unitId ? `&unit_id=${unitId}` : ''}`
  if (msg.type === 'template')
    return (
      <div>
        <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 700, color: isOut ? '#ffffff99' : '#8FA0AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Template</p>
        <p style={{ margin: 0, fontSize: 13, color: tc, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content ?? msg.template_name}</p>
      </div>
    )
  if (msg.type === 'text' || (!msg.media_url && msg.content))
    return <p style={{ margin: 0, fontSize: 13, color: tc, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</p>
  if (msg.type === 'image' && msg.media_url)
    return <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mediaUrl(msg.media_url)} alt="Imagem" style={{ maxWidth: 220, maxHeight: 200, borderRadius: 8, display: 'block', cursor: 'pointer' }} onClick={() => window.open(mediaUrl(msg.media_url!), '_blank')} />
      {msg.content && <p style={{ margin: '4px 0 0', fontSize: 12, color: tc }}>{msg.content}</p>}
    </div>
  if (msg.type === 'audio' && msg.media_url)
    return <audio controls style={{ height: 32, maxWidth: 220 }}><source src={mediaUrl(msg.media_url)} type={msg.media_mime_type ?? 'audio/ogg'} /></audio>
  if (msg.type === 'video' && msg.media_url)
    return <video controls style={{ maxWidth: 220, maxHeight: 180, borderRadius: 8 }}><source src={mediaUrl(msg.media_url)} type={msg.media_mime_type ?? 'video/mp4'} /></video>
  if (msg.type === 'document' && msg.media_url)
    return <a href={mediaUrl(msg.media_url)} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: tc }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{msg.content ?? 'Arquivo'}</span>
    </a>
  return <p style={{ margin: 0, fontSize: 12, color: sc, fontStyle: 'italic' }}>[{msg.type}]</p>
}

function InternalNoteBubble({ note }: { note: WaNote }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: '80%', padding: '7px 12px', borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#92400E', textTransform: 'uppercase' }}>Nota interna</span>
          <span style={{ fontSize: 10, color: '#B45309' }}>{note.author_name}</span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: '#78350F', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{note.content}</p>
        <p style={{ margin: '4px 0 0', fontSize: 10, color: '#B45309', textAlign: 'right' }}>{format(new Date(note.created_at), 'HH:mm')}</p>
      </div>
    </div>
  )
}


// ── ChatInput ─────────────────────────────────────────────────────────────────

function ChatInput({ value, onChange, onSend, onMediaUpload, onTemplateSend, onScheduleSend, templates, quickReplies, sending, mode, onModeChange, unitId, onTemplatesReload, onQuickRepliesReload, isOutside24hWindow, signatureEnabled, onToggleSignature, signerName }: {
  value: string; onChange: (v: string) => void; onSend: () => void
  onMediaUpload: (file: File) => void; onTemplateSend: (t: WaTemplate) => void
  onScheduleSend: (content: string, scheduledFor: string) => void
  templates: WaTemplate[]; quickReplies: WaQuickReply[]
  sending: boolean; mode: InputMode; onModeChange: (m: InputMode) => void
  unitId: string; onTemplatesReload: () => void; onQuickRepliesReload: () => void
  isOutside24hWindow: boolean; signatureEnabled: boolean
  onToggleSignature: () => void; signerName: string
}) {
  const imageRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const docRef   = useRef<HTMLInputElement>(null)
  const isNote   = mode === 'note'

  const [attachOpen,       setAttachOpen]       = useState(false)
  const [showTemplates,    setShowTemplates]     = useState(false)
  const [showQuickReplies, setShowQuickReplies]  = useState(false)
  const [scheduleMode,     setScheduleMode]      = useState(false)
  const [scheduleFor,      setScheduleFor]       = useState('')
  const [tmplSearch,       setTmplSearch]        = useState('')
  const [qrFilter,         setQrFilter]          = useState('')
  const [showNewTmpl,      setShowNewTmpl]       = useState(false)
  const [newTmplName,      setNewTmplName]       = useState('')
  const [newTmplContent,   setNewTmplContent]    = useState('')
  const [showNewQr,        setShowNewQr]         = useState(false)
  const [newQrShortcut,    setNewQrShortcut]     = useState('')
  const [newQrContent,     setNewQrContent]      = useState('')
  const [saving,           setSaving]            = useState(false)
  const [recording,        setRecording]         = useState(false)
  const [recordingTime,    setRecordingTime]      = useState(0)
  const mediaRecorderRef   = useRef<MediaRecorder | null>(null)
  const recordTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const supabase = createClient()

  useEffect(() => {
    if (!isNote && value.startsWith('/')) { setQrFilter(value.slice(1).toLowerCase()); setShowQuickReplies(true); setAttachOpen(false) }
    else if (showQuickReplies && !value.startsWith('/')) setShowQuickReplies(false)
  }, [value, isNote]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  async function startRecording() {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      console.error('[audio] getUserMedia error:', err)
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.')
      return
    }

    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : 'audio/webm;codecs=opus'
      const outMime  = mimeType === 'audio/ogg;codecs=opus' ? 'audio/ogg' : 'audio/webm'
      const ext      = mimeType === 'audio/ogg;codecs=opus' ? 'ogg'       : 'webm'

      const mr = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })
      const chunks: Blob[] = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks, { type: outMime })
        onMediaUpload(new File([blob], `audio_${Date.now()}.${ext}`, { type: outMime }))
      }
      mr.start()
      mediaRecorderRef.current = mr

      setRecording(true); setRecordingTime(0)
      recordTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch (err) {
      console.error('[audio] startRecording setup error:', err)
      stream.getTracks().forEach(t => t.stop())
      alert(`Erro ao iniciar gravação: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function stopRecording(send: boolean) {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null }
    const mr = mediaRecorderRef.current
    if (mr) {
      mediaRecorderRef.current = null
      if (!send) { mr.ondataavailable = null; mr.onstop = null; try { mr.stop() } catch {} ; mr.stream.getTracks().forEach(t => t.stop()) }
      else mr.stop()
    }
    setRecording(false); setRecordingTime(0)
  }

  function fmtRecTime(s: number) { return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}` }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (f) { onMediaUpload(f); e.target.value = '' }
  }

  function pickTemplate(t: WaTemplate) {
    if (t.category === 'meta_api') onTemplateSend(t); else onChange(t.content)
    setShowTemplates(false)
  }

  function pickQuickReply(qr: WaQuickReply) { onChange(qr.content); setShowQuickReplies(false) }

  async function saveTmpl() {
    if (!newTmplName.trim() || !newTmplContent.trim()) return
    setSaving(true)
    try {
      await supabase.from('wa_message_templates').insert({ unit_id: unitId, name: newTmplName.trim(), content: newTmplContent.trim(), category: 'custom' })
      setShowNewTmpl(false); setNewTmplName(''); setNewTmplContent(''); onTemplatesReload()
    } finally { setSaving(false) }
  }

  async function saveQr() {
    if (!newQrShortcut.trim() || !newQrContent.trim()) return
    setSaving(true)
    try {
      const shortcut = newQrShortcut.trim().startsWith('/') ? newQrShortcut.trim() : '/' + newQrShortcut.trim()
      await supabase.from('wa_quick_replies').insert({ unit_id: unitId, shortcut, content: newQrContent.trim() })
      setShowNewQr(false); setNewQrShortcut(''); setNewQrContent(''); onQuickRepliesReload()
    } finally { setSaving(false) }
  }

  const filtTmpls = templates.filter(t => !tmplSearch || t.name.toLowerCase().includes(tmplSearch) || t.content.toLowerCase().includes(tmplSearch))
  const filtQrs   = quickReplies.filter(q => !qrFilter || q.shortcut.toLowerCase().includes(qrFilter) || q.content.toLowerCase().includes(qrFilter))

  // Attach menu items
  const attachItems = [
    { key: 'image', label: 'Imagem',   icon: <IconPhoto />,    action: () => { imageRef.current?.click(); setAttachOpen(false) } },
    { key: 'video', label: 'Vídeo',    icon: <IconVideo />,    action: () => { videoRef.current?.click(); setAttachOpen(false) } },
    { key: 'audio', label: 'Áudio',    icon: <IconAudio />,    action: () => { audioRef.current?.click(); setAttachOpen(false) } },
    { key: 'doc',   label: 'Documento',icon: <IconDocument />, action: () => { docRef.current?.click();   setAttachOpen(false) } },
    null, // divider
    { key: 'tmpl', label: 'Modelo de mensagem', icon: <IconTemplate />, action: () => { setShowTemplates(v => !v); setAttachOpen(false) } },
    { key: 'qr',   label: 'Mensagens rápidas',  icon: <IconFlash />,    action: () => { setShowQuickReplies(v => !v); setAttachOpen(false) } },
    { key: 'sched',label: 'Agendar mensagem',    icon: <IconClock />,    action: () => { setScheduleMode(v => !v); setAttachOpen(false) } },
  ] as const

  return (
    <div style={{ borderTop: '1px solid #F1F4F7', background: '#fff', flexShrink: 0, position: 'relative' }}>
      {/* Hidden file inputs */}
      <input ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      <input ref={videoRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFile} />
      <input ref={audioRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleFile} />
      <input ref={docRef}   type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" style={{ display: 'none' }} onChange={handleFile} />

      {/* Template popup */}
      {showTemplates && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px 12px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,0.10)', zIndex: 90, maxHeight: 320, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #F1F4F7', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <IconTemplate /> <p style={{ fontSize: 12, fontWeight: 700, color: '#0E2C3D', margin: 0, flex: 1 }}>Modelos de Mensagem</p>
            <button onClick={() => setShowNewTmpl(v => !v)} style={{ fontSize: 10, fontWeight: 600, color: '#0098DA', background: 'none', border: 'none', cursor: 'pointer' }}>+ Novo</button>
            <button onClick={() => setShowTemplates(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B0BEC9', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
          {showNewTmpl && (
            <div style={{ padding: '10px 14px', background: '#F0F8FF', borderBottom: '1px solid #E8EDF2', flexShrink: 0 }}>
              <input value={newTmplName} onChange={e => setNewTmplName(e.target.value)} placeholder="Nome do modelo..."
                style={{ width: '100%', fontSize: 12, border: '1px solid #B3DFFF', borderRadius: 7, padding: '5px 8px', outline: 'none', marginBottom: 6, boxSizing: 'border-box', background: '#fff' }} />
              <textarea value={newTmplContent} onChange={e => setNewTmplContent(e.target.value)} placeholder="Texto da mensagem..." rows={2}
                style={{ width: '100%', fontSize: 12, border: '1px solid #B3DFFF', borderRadius: 7, padding: '5px 8px', outline: 'none', resize: 'none', marginBottom: 6, boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff' }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => void saveTmpl()} disabled={saving} style={{ flex: 1, padding: '5px', fontSize: 11, fontWeight: 700, background: '#0098DA', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'Salvar'}</button>
                <button onClick={() => setShowNewTmpl(false)} style={{ flex: 1, padding: '5px', fontSize: 11, border: '1px solid #E8EDF2', borderRadius: 7, cursor: 'pointer', background: '#fff', color: '#5A7184' }}>Cancelar</button>
              </div>
            </div>
          )}
          <div style={{ padding: '6px 10px', flexShrink: 0 }}>
            <input value={tmplSearch} onChange={e => setTmplSearch(e.target.value.toLowerCase())} placeholder="Buscar modelo..."
              style={{ width: '100%', fontSize: 11, border: '1px solid #E8EDF2', borderRadius: 7, padding: '4px 8px', outline: 'none', boxSizing: 'border-box', background: '#F8FAFB' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtTmpls.length === 0 && <p style={{ fontSize: 12, color: '#B0BEC9', textAlign: 'center', padding: '12px 0', margin: 0 }}>Nenhum modelo</p>}
            {filtTmpls.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 14px', borderBottom: '1px solid #F8FAFB', cursor: 'pointer' }} onClick={() => pickTemplate(t)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0E2C3D' }}>{t.name}</span>
                    {t.category === 'meta_api' && <span style={{ fontSize: 9, fontWeight: 700, background: '#E8F7EE', color: '#1D9E75', borderRadius: 4, padding: '1px 5px' }}>META</span>}
                  </div>
                  <p style={{ fontSize: 11, color: '#8FA0AF', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.category === 'meta_api' ? `Template: ${t.template_name}` : t.content}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); void supabase.from('wa_message_templates').update({ ativo: false }).eq('id', t.id).then(onTemplatesReload) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D1D5DB', flexShrink: 0, lineHeight: 0, padding: 2 }}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7M10 11v6m4-6v6M4 7h16M9 7V4h6v3" /></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick replies popup */}
      {showQuickReplies && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px 12px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,0.10)', zIndex: 90, maxHeight: 280, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #F1F4F7', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <IconFlash /> <p style={{ fontSize: 12, fontWeight: 700, color: '#0E2C3D', margin: 0, flex: 1 }}>Respostas Rápidas</p>
            <button onClick={() => setShowNewQr(v => !v)} style={{ fontSize: 10, fontWeight: 600, color: '#F59E0B', background: 'none', border: 'none', cursor: 'pointer' }}>+ Nova</button>
            <button onClick={() => setShowQuickReplies(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B0BEC9', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
          {showNewQr && (
            <div style={{ padding: '10px 14px', background: '#FFFBEB', borderBottom: '1px solid #FDE68A', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input value={newQrShortcut} onChange={e => setNewQrShortcut(e.target.value)} placeholder="/atalho"
                  style={{ width: 90, fontSize: 12, border: '1px solid #FDE68A', borderRadius: 7, padding: '5px 8px', outline: 'none', background: '#fff', fontFamily: 'monospace' }} />
                <input value={newQrContent} onChange={e => setNewQrContent(e.target.value)} placeholder="Conteúdo da resposta..."
                  style={{ flex: 1, fontSize: 12, border: '1px solid #FDE68A', borderRadius: 7, padding: '5px 8px', outline: 'none', background: '#fff' }} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => void saveQr()} disabled={saving} style={{ flex: 1, padding: '5px', fontSize: 11, fontWeight: 700, background: '#F59E0B', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'Salvar'}</button>
                <button onClick={() => setShowNewQr(false)} style={{ flex: 1, padding: '5px', fontSize: 11, border: '1px solid #E8EDF2', borderRadius: 7, cursor: 'pointer', background: '#fff', color: '#5A7184' }}>Cancelar</button>
              </div>
            </div>
          )}
          <div style={{ padding: '6px 10px', flexShrink: 0 }}>
            <input value={qrFilter} onChange={e => setQrFilter(e.target.value.toLowerCase())} placeholder="Buscar atalho ou digite / no chat..."
              style={{ width: '100%', fontSize: 11, border: '1px solid #E8EDF2', borderRadius: 7, padding: '4px 8px', outline: 'none', boxSizing: 'border-box', background: '#F8FAFB' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtQrs.length === 0 && <p style={{ fontSize: 12, color: '#B0BEC9', textAlign: 'center', padding: '12px 0', margin: 0 }}>{quickReplies.length === 0 ? 'Nenhuma ainda. Crie com + Nova.' : 'Nenhum resultado'}</p>}
            {filtQrs.map(qr => (
              <div key={qr.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 14px', borderBottom: '1px solid #F8FAFB', cursor: 'pointer' }} onClick={() => pickQuickReply(qr)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', fontFamily: 'monospace' }}>{qr.shortcut}</span>
                  <p style={{ fontSize: 11, color: '#5A7184', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qr.content}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); void supabase.from('wa_quick_replies').update({ ativo: false }).eq('id', qr.id).then(onQuickRepliesReload) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D1D5DB', flexShrink: 0, lineHeight: 0, padding: 2 }}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7M10 11v6m4-6v6M4 7h16M9 7V4h6v3" /></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 24h window warning */}
      {isOutside24hWindow && !isNote && (
        <div style={{ margin: '6px 12px 0', padding: '8px 12px', background: '#FFF8E1', border: '1px solid #FDE68A', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#92400E', margin: 0 }}>Janela de 24h encerrada</p>
            <p style={{ fontSize: 11, color: '#B45309', margin: '2px 0 0', lineHeight: 1.4 }}>A última mensagem do cliente foi há mais de 24h. Use um <strong>template</strong> para iniciar a conversa.</p>
          </div>
        </div>
      )}

      {/* Mode toggle */}
      <div style={{ padding: '6px 14px 0', display: 'flex', gap: 4, alignItems: 'center' }}>
        <button onClick={() => { onModeChange('text'); setScheduleMode(false) }}
          style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, border: 'none', cursor: 'pointer', background: !isNote ? '#0098DA' : '#F1F4F7', color: !isNote ? '#fff' : '#8FA0AF' }}>
          Mensagem
        </button>
        <button onClick={() => { onModeChange('note'); setScheduleMode(false); setAttachOpen(false); setShowTemplates(false); setShowQuickReplies(false) }}
          style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, border: 'none', cursor: 'pointer', background: isNote ? '#F59E0B' : '#F1F4F7', color: isNote ? '#fff' : '#8FA0AF' }}>
          Nota interna
        </button>
        {!isNote && (
          <button onClick={onToggleSignature} title={signatureEnabled ? `Assinatura ativa: "${signerName}: ..."` : 'Ativar assinatura'}
            style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 99, border: `1px solid ${signatureEnabled ? '#0098DA' : '#E8EDF2'}`, cursor: 'pointer', background: signatureEnabled ? '#EFF7FF' : '#F8FAFB', color: signatureEnabled ? '#0098DA' : '#8FA0AF', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            {signatureEnabled ? signerName : 'Assinatura'}
          </button>
        )}
      </div>

      {/* Schedule row */}
      {scheduleMode && !isNote && (
        <div style={{ padding: '6px 14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8B5CF6', flexShrink: 0 }}>Enviar em:</span>
          <div style={{ flex: 1 }}>
            <DateTimePicker
              value={scheduleFor}
              onChange={v => setScheduleFor(v)}
              placeholder="Selecionar data e hora"
              minNow
            />
          </div>
          <button onClick={() => { setScheduleMode(false); setScheduleFor('') }} style={{ fontSize: 13, color: '#B0BEC9', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Input row */}
      <div style={{ padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        {/* Attach button + dropdown */}
        {!isNote && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setAttachOpen(v => !v)} title="Anexar / ferramentas"
              style={{ width: 38, height: 38, borderRadius: 10, border: `1px solid ${attachOpen ? '#0098DA' : '#E8EDF2'}`, background: attachOpen ? '#EFF7FF' : '#F8FAFB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="17" height="17" fill="none" stroke={attachOpen ? '#0098DA' : '#8FA0AF'} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            {attachOpen && (
              <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, boxShadow: '0 -4px 24px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 210, overflow: 'hidden', paddingBlock: 4 }}>
                {attachItems.map((item, i) =>
                  item === null
                    ? <div key={`div-${i}`} style={{ height: 1, background: '#F1F4F7', margin: '4px 0' }} />
                    : (
                      <button key={item.key} onClick={item.action}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 13, color: '#0E2C3D', fontWeight: 500, transition: 'background 0.1s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFB')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                        {item.icon}
                        {item.label}
                      </button>
                    )
                )}
              </div>
            )}
          </div>
        )}

        {/* Recording UI */}
        {recording ? (
          <>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, height: 38 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#EF4444', flexShrink: 0, animation: 'pulse 1s ease-in-out infinite' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#DC2626', fontFamily: 'monospace' }}>{fmtRecTime(recordingTime)}</span>
              <span style={{ fontSize: 11, color: '#F87171', flex: 1 }}>Gravando áudio...</span>
            </div>
            <button onClick={() => stopRecording(false)} title="Cancelar"
              style={{ width: 38, height: 38, borderRadius: 9, border: '1px solid #E8EDF2', background: '#F8FAFB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="14" height="14" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <button onClick={() => stopRecording(true)} title="Enviar áudio"
              style={{ width: 38, height: 38, borderRadius: 9, border: 'none', background: '#25D366', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="17" height="17" fill="none" stroke="#fff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </button>
          </>
        ) : (
          <>
            <textarea value={value} onChange={e => onChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !scheduleMode) { e.preventDefault(); onSend() } if (e.key === 'Escape') { setAttachOpen(false); setShowTemplates(false); setShowQuickReplies(false) } }}
              placeholder={isNote ? 'Nota interna (só a equipe vê)...' : scheduleMode ? 'Mensagem a agendar...' : 'Mensagem ou / para respostas rápidas...'}
              rows={1}
              style={{ flex: 1, resize: 'none', border: `1px solid ${isNote ? '#FDE68A' : '#E8EDF2'}`, borderRadius: 10, padding: '9px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto', background: isNote ? '#FFFBEB' : '#F8FAFB' }}
            />

            {scheduleMode ? (
              <button onClick={() => { if (!value.trim() || !scheduleFor) return; onScheduleSend(value.trim(), new Date(scheduleFor).toISOString()); setScheduleMode(false); setScheduleFor('') }}
                disabled={!value.trim() || !scheduleFor}
                style={{ padding: '0 14px', height: 38, borderRadius: 9, flexShrink: 0, cursor: value.trim() && scheduleFor ? 'pointer' : 'default', background: value.trim() && scheduleFor ? '#8B5CF6' : '#E8EDF2', border: 'none', fontSize: 11, fontWeight: 700, color: value.trim() && scheduleFor ? '#fff' : '#B0BEC9', whiteSpace: 'nowrap' }}>
                Agendar ▶
              </button>
            ) : value.trim() ? (
              <button onClick={onSend} disabled={sending}
                style={{ width: 38, height: 38, borderRadius: 9, flexShrink: 0, cursor: !sending ? 'pointer' : 'default', background: isNote ? '#F59E0B' : '#0098DA', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}>
                {sending ? <Spinner size={16} color="#fff" /> : <svg width="17" height="17" fill="none" stroke="#fff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>}
              </button>
            ) : !isNote ? (
              <button onClick={() => void startRecording()} title="Gravar áudio"
                style={{ width: 38, height: 38, borderRadius: 9, border: '1px solid #E8EDF2', background: '#F8FAFB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s' }}>
                <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                </svg>
              </button>
            ) : (
              <div style={{ width: 38 }} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── LeadContextView ───────────────────────────────────────────────────────────

function calcAgeCtx(dob: string | null): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age < 0 ? 0 : age
}


function LeadContextView({ detail, conv, onOpen, onUnlink, onCreateQuote, onSchedule }: {
  detail: LeadDetail; conv: WaConversation
  onOpen: (l: LeadKanban) => void; onUnlink: () => void
  onCreateQuote: () => void; onSchedule: () => void
}) {
  const { lead, latestNote, tasks, contacts } = detail
  const fmtDate = (s: string) => format(new Date(s), "d MMM 'às' HH:mm", { locale: ptBR })

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #F1F4F7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: '#8FA0AF', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Contato vinculado</p>
        <button onClick={onUnlink} style={{ fontSize: 10, color: '#B0BEC9', background: 'none', border: 'none', cursor: 'pointer' }}>desvincular</button>
      </div>

      <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#E3F2FD', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1565C0' }}>{lead.nome[0]?.toUpperCase()}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#0E2C3D', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lead.nome}{lead.sobrenome ? ` ${lead.sobrenome}` : ''}
            </p>
            {lead.stage_nome && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: (lead.stage_cor ?? '#0098DA') + '22', color: lead.stage_cor ?? '#0098DA' }}>
                {lead.stage_nome}
              </span>
            )}
          </div>
        </div>

        {/* Info rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {lead.telefone && <InfoRow label="Telefone" value={lead.telefone} />}
          {lead.email    && <InfoRow label="E-mail"   value={lead.email} />}
          {lead.responsavel_nome && <InfoRow label="Responsável" value={lead.responsavel_nome} />}
        </div>

        {/* Pacientes */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#8FA0AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, marginTop: 0 }}>
            Pacientes {contacts.length > 0 && <span style={{ color: '#0098DA' }}>({contacts.length})</span>}
          </p>
          {contacts.length === 0 ? (
            <p style={{ fontSize: 11, color: '#B0BEC9', margin: 0, fontStyle: 'italic' }}>Nenhum paciente vinculado</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {contacts.map(c => {
                const age = calcAgeCtx(c.data_nascimento)
                return (
                  <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', background: '#F8FAFB', border: '1px solid #F1F4F7', borderRadius: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: '#0E2C3D', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</p>
                      <p style={{ fontSize: 10, color: '#8FA0AF', margin: 0 }}>
                        {c.relacao ? c.relacao.charAt(0).toUpperCase() + c.relacao.slice(1) : 'Paciente'}
                        {age !== null && ` · ${age} ano${age !== 1 ? 's' : ''}`}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Ações rápidas */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#8FA0AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, marginTop: 0 }}>Ações Rápidas</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              onClick={onCreateQuote}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 12, fontWeight: 600, color: '#0E2C3D', background: '#fff', border: '1px solid #E8EDF2', borderRadius: 9, cursor: 'pointer', textAlign: 'left' }}>
              Novo orçamento
            </button>
            <button
              onClick={onSchedule}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 12, fontWeight: 600, color: '#0E2C3D', background: '#fff', border: '1px solid #E8EDF2', borderRadius: 9, cursor: 'pointer', textAlign: 'left' }}>
              Agendar consulta
            </button>
          </div>
        </div>

        {/* Last note */}
        {latestNote && (
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#8FA0AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5, marginTop: 0 }}>Última anotação</p>
            <div style={{ background: '#F8FAFB', border: '1px solid #F1F4F7', borderRadius: 8, padding: '7px 10px' }}>
              <p style={{ fontSize: 11, color: '#5A7184', margin: 0, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{latestNote}</p>
            </div>
          </div>
        )}

        {/* Pending tasks */}
        {tasks.length > 0 && (
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#8FA0AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5, marginTop: 0 }}>Tarefas ({tasks.length})</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {tasks.slice(0, 3).map(t => {
                const overdue = t.data_limite && new Date(t.data_limite) < new Date()
                return (
                  <div key={t.id} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: overdue ? '#EF4444' : '#F59E0B', marginTop: 5, flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, color: '#0E2C3D', margin: 0 }}>{t.titulo}</p>
                      {t.data_limite && <p style={{ fontSize: 10, color: overdue ? '#EF4444' : '#8FA0AF', margin: 0 }}>{fmtDate(t.data_limite)}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <button onClick={() => onOpen(lead)}
          style={{ width: '100%', padding: '8px', fontSize: 12, fontWeight: 600, color: '#0098DA', background: '#F0F8FF', border: '1px solid #B3DFFF', borderRadius: 9, cursor: 'pointer' }}>
          Ver card completo →
        </button>
      </div>
    </div>
  )
}

// ── LinkLeadView ──────────────────────────────────────────────────────────────

function LinkLeadView({ showPanel, onToggle, searchQ, onSearch, results, searching, onLink, onCreate }: {
  showPanel: boolean; onToggle: () => void; searchQ: string; onSearch: (q: string) => void
  results: LeadKanban[]; searching: boolean; onLink: (l: LeadKanban) => void; onCreate: () => void
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 14 }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#8FA0AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12, marginTop: 0 }}>Cliente</p>
      {!showPanel ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ textAlign: 'center', padding: '20px 0 12px' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#F1F4F7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
              <svg width="20" height="20" fill="none" stroke="#B0BEC9" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            </div>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#5A7184', margin: '0 0 4px' }}>Sem contato vinculado</p>
            <p style={{ fontSize: 11, color: '#B0BEC9', margin: 0, lineHeight: 1.4 }}>Vincule esta conversa a um contato do CRM</p>
          </div>
          <button onClick={onToggle} style={{ padding: '8px', fontSize: 12, fontWeight: 600, color: '#0098DA', background: '#F0F8FF', border: '1px solid #B3DFFF', borderRadius: 9, cursor: 'pointer' }}>Vincular contato</button>
          <button onClick={onCreate} style={{ padding: '8px', fontSize: 12, fontWeight: 600, color: '#5A7184', background: '#F8FAFB', border: '1px solid #E8EDF2', borderRadius: 9, cursor: 'pointer' }}>+ Criar novo contato</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8FA0AF', fontSize: 16, lineHeight: 1, padding: 0 }}>←</button>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#0E2C3D', margin: 0 }}>Buscar contato</p>
          </div>
          <input type="text" placeholder="Nome ou telefone..." value={searchQ} onChange={e => onSearch(e.target.value)} autoFocus
            style={{ width: '100%', padding: '7px 10px', fontSize: 12, border: '1px solid #E8EDF2', borderRadius: 8, background: '#F8FAFB', outline: 'none', boxSizing: 'border-box' }} />
          {searching && <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}><Spinner size={18} color="#0098DA" /></div>}
          {!searching && results.map(lead => (
            <button key={lead.id} onClick={() => onLink(lead)}
              style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid #E8EDF2', borderRadius: 9, background: '#fff', cursor: 'pointer' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#E3F2FD', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#1565C0' }}>{lead.nome[0]?.toUpperCase()}</span>
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#0E2C3D', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.nome}{lead.sobrenome ? ` ${lead.sobrenome}` : ''}</p>
                <p style={{ fontSize: 10, color: '#8FA0AF', margin: 0 }}>{lead.telefone ?? 'Sem telefone'}</p>
              </div>
            </button>
          ))}
          {!searching && searchQ && results.length === 0 && <p style={{ fontSize: 12, color: '#B0BEC9', textAlign: 'center', margin: 0 }}>Nenhum resultado</p>}
        </div>
      )}
    </div>
  )
}

// ── EmptyChatState ────────────────────────────────────────────────────────────

function EmptyChatState() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
      <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#F1F4F7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="24" height="24" fill="none" stroke="#B0BEC9" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
      </div>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#5A7184', margin: 0 }}>Selecione uma conversa</p>
      <p style={{ fontSize: 12, color: '#B0BEC9', margin: 0 }}>Escolha uma conversa à esquerda</p>
    </div>
  )
}

// ── Icon components ───────────────────────────────────────────────────────────

function IconPhoto()    { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> }
function IconVideo()    { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> }
function IconAudio()    { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg> }
function IconDocument() { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> }
function IconTemplate() { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8h18M3 12h18M3 16h10" /></svg> }
function IconFlash()    { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> }
function IconClock()    { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }

// ── NewConversationModal ───────────────────────────────────────────────────────

interface MetaApprovedTemplate { name: string; language: string; bodyText: string }

function NewConversationModal({ unitId, onStart, onClose }: {
  unitId:  string
  onStart: (phone: string, unitId: string, templateName: string, language: string, components: object[], registerOptin: boolean, bodyText: string) => Promise<void>
  onClose: () => void
}) {
  const [phone,        setPhone]        = useState('')
  const [tmplIdx,      setTmplIdx]      = useState(0)
  const [sending,      setSending]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [metaTmpls,    setMetaTmpls]    = useState<MetaApprovedTemplate[] | null>(null)
  const [loadingT,     setLoadingT]     = useState(true)
  const [regOptin,     setRegOptin]     = useState(true)

  // Busca templates aprovados direto da Meta ao abrir o modal
  useEffect(() => {
    void (async () => {
      try {
        const res  = await fetch('/api/whatsapp/meta-templates')
        const data = await res.json() as { templates?: { name: string; status: string; language: string; components?: { type: string; text?: string }[] }[]; error?: string }
        if (!res.ok || data.error) { setMetaTmpls([]); return }
        const approved = (data.templates ?? [])
          .filter(t => t.status === 'APPROVED')
          .map(t => ({
            name:     t.name,
            language: t.language,
            bodyText: t.components?.find(c => c.type === 'BODY')?.text ?? '',
          }))
        setMetaTmpls(approved)
      } catch { setMetaTmpls([]) }
      finally { setLoadingT(false) }
    })()
  }, [])

  const selected = metaTmpls?.[tmplIdx] ?? null

  async function handleSend() {
    setError(null)
    if (!phone.trim()) { setError('Informe o telefone do contato'); return }
    if (!selected)     { setError('Selecione um template'); return }
    setSending(true)
    try {
      await onStart(phone.trim(), unitId, selected.name, selected.language, [], regOptin, selected.bodyText)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao iniciar conversa')
    } finally { setSending(false) }
  }

  const noTmpls = !loadingT && (metaTmpls ?? []).length === 0

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,44,61,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 440, maxWidth: '94vw', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0E2C3D', margin: 0 }}>Nova conversa</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8FA0AF', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>

        <label style={{ fontSize: 11, fontWeight: 700, color: '#8FA0AF', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Telefone (DDD + número)</label>
        <input
          type="tel"
          placeholder="Ex: 11999998888"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          style={{ width: '100%', border: '1.5px solid #E8EDF2', borderRadius: 10, padding: '9px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 16, color: '#0E2C3D' }}
        />

        <label style={{ fontSize: 11, fontWeight: 700, color: '#8FA0AF', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Template de abertura</label>
        {loadingT ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Spinner size={16} color="#0098DA" />
            <span style={{ fontSize: 12, color: '#8FA0AF' }}>Carregando templates aprovados…</span>
          </div>
        ) : noTmpls ? (
          <p style={{ fontSize: 12, color: '#B0BEC9', marginBottom: 16 }}>
            Nenhum template aprovado na Meta. Acesse <strong>Configurações → Templates</strong> e aguarde a aprovação.
          </p>
        ) : (
          <>
            <select
              value={tmplIdx}
              onChange={e => setTmplIdx(Number(e.target.value))}
              style={{ width: '100%', border: '1.5px solid #E8EDF2', borderRadius: 10, padding: '9px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 12, background: '#fff', color: '#0E2C3D', cursor: 'pointer' }}
            >
              {(metaTmpls ?? []).map((t, i) => <option key={`${t.name}-${t.language}`} value={i}>{t.name} ({t.language})</option>)}
            </select>
            {selected?.bodyText && (
              <div style={{ background: '#F0F8FF', border: '1px solid #D0EAFB', borderRadius: 10, padding: '10px 13px', marginBottom: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#0098DA', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prévia</p>
                <p style={{ fontSize: 13, color: '#0E2C3D', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{selected.bodyText}</p>
              </div>
            )}
          </>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={regOptin} onChange={e => setRegOptin(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: '#0098DA', flexShrink: 0, cursor: 'pointer' }} />
          <span style={{ fontSize: 12, color: '#5A7184', lineHeight: 1.4 }}>
            Registrar autorização WhatsApp para este contato
          </span>
        </label>

        {error && <p style={{ fontSize: 12, color: '#E53E3E', marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', fontSize: 13, border: '1px solid #E8EDF2', borderRadius: 10, cursor: 'pointer', background: '#fff', color: '#5A7184', fontWeight: 600 }}>Cancelar</button>
          <button onClick={handleSend} disabled={sending || noTmpls || loadingT}
            style={{ flex: 2, padding: '10px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 10,
              cursor: sending || noTmpls || loadingT ? 'default' : 'pointer',
              background: sending || noTmpls || loadingT ? '#E8EDF2' : '#25D366',
              color: sending || noTmpls || loadingT ? '#B0BEC9' : '#fff', transition: 'all 0.15s' }}>
            {sending ? 'Enviando…' : 'Iniciar conversa'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shared ────────────────────────────────────────────────────────────────────

function StatusTick({ status }: { status: string }) {
  if (status === 'failed') return <span style={{ fontSize: 10, color: '#ff6b6b', fontWeight: 700 }}>!</span>
  const c = status === 'read' ? '#fff' : '#ffffffaa'
  if (status === 'sent') return <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5l3 3 5-7" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  return <svg width="18" height="10" viewBox="0 0 18 10" fill="none"><path d="M1 5l3 3 5-7" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M6 5l3 3 5-7" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 5, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 11, color: '#8FA0AF', width: 72, textAlign: 'right', flexShrink: 0, lineHeight: '18px' }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: highlight ? 700 : 400, color: highlight ? '#1D9E75' : '#0E2C3D', flex: 1, wordBreak: 'break-all', lineHeight: '18px' }}>{value}</span>
    </div>
  )
}

function Spinner({ size, color }: { size: number; color: string }) {
  return <div style={{ width: size, height: size, border: `2px solid ${color}33`, borderTopColor: color, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
}

function formatConvTime(iso: string): string {
  const d = new Date(iso)
  if (isToday(d))     return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Ontem'
  return format(d, 'dd/MM', { locale: ptBR })
}
