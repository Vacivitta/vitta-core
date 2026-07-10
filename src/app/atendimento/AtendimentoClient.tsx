'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { format, isToday, isYesterday, differenceInDays, differenceInHours } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { LeadKanban, FunnelWithStages, Profile, LeadTask, LeadContact } from '@/types/database'
import { displayName } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import LeadModal from '@/components/leads/LeadModal'
import QuickLeadForm from '@/components/leads/QuickLeadForm'
import MediaContent from '@/components/whatsapp/MediaContent'
import ChatInputComponent from '@/components/whatsapp/ChatInput'
import type { WaTemplate, WaQuickReply, InputMode, ConvTag } from '@/components/whatsapp/wa-types'
import ConvTagsBar from '@/components/whatsapp/ConvTagsBar'
import NewConversationModal from '@/components/whatsapp/NewConversationModal'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WaQueue     { id: string; nome: string; cor: string; auto_assign?: boolean }
// WaTemplate, WaQuickReply, InputMode imported from @/components/whatsapp/wa-types
// ConvTag imported from wa-types

interface WaConversation {
  id: string; wa_phone: string; wa_contact_name: string | null
  status: 'open' | 'pending' | 'resolved'; unread_count: number
  last_message_at: string | null; lead_id: string | null
  assigned_to: string | null; queue_id: string | null; unit_id: string | null
  profile_picture_url?: string | null
  last_message_content?: string | null
  last_message_direction?: 'inbound' | 'outbound' | null
  lead?: { nome: string; sobrenome: string | null } | null
  tags?: { tag: ConvTag }[]
}

interface WaMessage {
  id: string; wa_message_id?: string | null; direction: 'inbound' | 'outbound'; type: string
  content: string | null; media_url: string | null; media_mime_type: string | null
  template_name: string | null
  status: string; created_at: string; sent_by: string | null
  reply_to_wa_message_id?: string | null
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
  items_summary?: string | null
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


const STATUS_LABELS: Record<ConvStatus, string> = { all: 'Todas', open: 'Aberta', pending: 'Pendente', resolved: 'Resolvida' }
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open:     { bg: '#E8F4E6', text: '#35853F' },
  pending:  { bg: '#FCF3E4', text: '#C87F1B' },
  resolved: { bg: '#F1EFE5', text: '#9AA79C' },
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
  const [contactNamesByLead, setContactNamesByLead] = useState<Record<string, string>>({})

  const [conversations, setConversations] = useState<WaConversation[]>([])
  const conversationsRef = useRef<WaConversation[]>([])
  useEffect(() => { conversationsRef.current = conversations }, [conversations])
  const [convsLoaded,   setConvsLoaded]   = useState(false)
  const [convSearch,    setConvSearch]    = useState('')
  const [filterStatus,  setFilterStatus]  = useState<ConvStatus>('all')
  const [filterQueue,   setFilterQueue]   = useState<string>('all')
  const [filterMine,    setFilterMine]    = useState(false)
  const [filterTag,     setFilterTag]     = useState<string>('all')
  const [unitTags,      setUnitTags]      = useState<ConvTag[]>([])
  const [convTags,      setConvTags]      = useState<ConvTag[]>([])
  const [selectedConv,  setSelectedConv]  = useState<WaConversation | null>(null)

  const [chatItems,  setChatItems]  = useState<ChatItem[]>([])
  const [msgsLoaded, setMsgsLoaded] = useState(false)
  const [chatInput,         setChatInput]         = useState('')
  const [inputMode,         setInputMode]         = useState<InputMode>('text')
  const [sending,           setSending]           = useState(false)
  const [replyTo,           setReplyTo]           = useState<WaMessage | null>(null)
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
    setConvTags((conv?.tags ?? []).map(t => t.tag))
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

  // Pede permissão de notificação nativa na primeira visita
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])

  // Subscription global — toca som e/ou mostra notificação nativa para mensagens inbound
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
        const msg = payload.new as { direction: string; conversation_id: string }
        if (msg.direction !== 'inbound') return
        if (!soundEnabledRef.current) return

        // Som via Web Audio (funciona quando a aba está visível)
        playNotificationSound()

        // Notificação nativa quando a aba está minimizada/em segundo plano
        if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
          const conv = conversationsRef.current.find(c => c.id === msg.conversation_id)
          const name = conv?.lead
            ? `${conv.lead.nome}${conv.lead.sobrenome ? ` ${conv.lead.sobrenome}` : ''}`
            : conv?.wa_contact_name ?? conv?.wa_phone ?? 'WhatsApp'
          const n = new Notification('Nova mensagem — VittaDesk', {
            body: name,
            icon: '/favicon.ico',
            tag:  `wa-conv-${msg.conversation_id}`, // agrupa por conversa, não empilha
          })
          n.onclick = () => { window.focus() }
        }
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, currentUser.unit_id])

  type RenderItem = ChatItem | { kind: 'date'; label: string; key: string }
  const chatRenderItems = useMemo<RenderItem[]>(() => {
    const result: RenderItem[] = []
    let lastDate = ''
    for (const item of chatItems) {
      const d = new Date(item.created_at)
      const dateKey = format(d, 'yyyy-MM-dd')
      if (dateKey !== lastDate) {
        const label = isToday(d) ? 'Hoje'
          : isYesterday(d) ? 'Ontem'
          : d.getFullYear() === new Date().getFullYear()
            ? format(d, "d 'de' MMM", { locale: ptBR })
            : format(d, 'dd/MM/yyyy')
        result.push({ kind: 'date', label, key: `date-${dateKey}` })
        lastDate = dateKey
      }
      result.push(item)
    }
    return result
  }, [chatItems])

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
    void (async () => {
      try {
        // Busca templates aprovados direto da Meta (sempre atualizados)
        const metaRes  = await fetch('/api/whatsapp/meta-templates')
        const metaData = await metaRes.json() as { templates?: Array<{ name: string; status: string; language: string; components?: Array<{ type: string; text?: string }>; variable_order?: string[] }> }
        const metaTmpls: WaTemplate[] = (metaData.templates ?? [])
          .filter(t => t.status === 'APPROVED')
          .map(t => ({
            id:             t.name,
            name:           t.name,
            content:        t.components?.find(c => c.type === 'BODY')?.text ?? '',
            category:       'meta_api' as const,
            template_name:  t.name,
            language:       t.language,
            variable_order: t.variable_order ?? [],
          }))
        // Carrega templates custom do banco
        const { data: custom } = await supabase.from('wa_message_templates')
          .select('id,name,content,category,template_name,language')
          .eq('ativo', true).eq('category', 'custom').order('name')
        setTemplates([...metaTmpls, ...((custom ?? []) as WaTemplate[])])
      } catch {
        // Fallback: carrega tudo do banco se a Meta API falhar
        const { data } = await supabase.from('wa_message_templates')
          .select('id,name,content,category,template_name,language').eq('ativo', true).order('name')
        setTemplates((data ?? []) as WaTemplate[])
      }
    })()
    void supabase.from('wa_quick_replies').select('id,shortcut,content').eq('ativo', true).order('shortcut')
      .then(({ data }) => setQuickReplies((data ?? []) as WaQuickReply[]))
    void fetch('/api/whatsapp/tags').then(r => r.json()).then((data: ConvTag[]) => setUnitTags(Array.isArray(data) ? data : []))
    void supabase.from('lead_contacts').select('lead_id, nome').then(({ data }) => {
      if (!data) return
      const map: Record<string, string> = {}
      for (const c of data) { map[c.lead_id] = map[c.lead_id] ? `${map[c.lead_id]} ${c.nome}` : c.nome }
      setContactNamesByLead(map)
    })
  }, [supabase])

  // ── Load conversations ──────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from('wa_conversations')
      .select('id,wa_phone,wa_contact_name,status,unread_count,last_message_at,lead_id,assigned_to,queue_id,unit_id,profile_picture_url,last_message_content,last_message_direction,lead:leads(nome,sobrenome),tags:wa_conversation_tags(tag:wa_tags(id,name,color))')
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
    if (!selectedConv) { setChatItems([]); setMsgsLoaded(false); setLeadDetail(null); setReplyTo(null); return }
    setMsgsLoaded(false); setChatItems([]); setReplyTo(null)
    void Promise.all([
      supabase.from('wa_messages')
        .select('id,wa_message_id,direction,type,content,media_url,media_mime_type,template_name,status,created_at,sent_by,reply_to_wa_message_id')
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
      void fetch('/api/whatsapp/mark-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id }) })
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
      supabase.from('quotes').select('id,status,total_calculado,criado_em,quote_items(quantidade,nome_snapshot)').eq('lead_id', leadId).order('criado_em', { ascending: false }).limit(1),
      supabase.from('lead_stage_history').select('created_at').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1),
      supabase.from('lead_contacts').select('*').eq('lead_id', leadId).order('created_at'),
    ])
    if (lead) setLeadDetail({
      lead: lead as LeadKanban,
      latestNote:   notes?.[0]?.conteudo ?? null,
      tasks:        (tasks ?? []) as LeadTask[],
      lastQuote:    quotes?.[0] ? {
        ...quotes[0],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items_summary: ((quotes[0] as any).quote_items ?? []).map((i: any) => `${i.quantidade}× ${i.nome_snapshot}`).join(', ') || null,
      } as LastQuote : null,
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
          void fetch('/api/whatsapp/mark-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id }) })
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
      text = `*${displayName(currentUser)}*: ${text}`
    }
    const replyWaId = replyTo?.wa_message_id ?? undefined
    setChatInput(''); setReplyTo(null); setSending(true)
    try {
      if (inputMode === 'note') {
        await fetch('/api/whatsapp/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id, content: text }) })
      } else {
        await fetch('/api/whatsapp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id, content: text, context_message_id: replyWaId }) })
        // Atualiza preview imediatamente sem esperar realtime
        const convId = selectedConv.id
        setConversations(prev => prev.map(c => c.id === convId
          ? { ...c, last_message_content: text, last_message_direction: 'outbound' }
          : c))
      }
    } finally { setSending(false) }
  }

  async function handleMediaUpload(file: File, caption?: string) {
    if (!selectedConv) return
    setSending(true)
    try {
      const form = new FormData(); form.append('file', file); form.append('conversation_id', selectedConv.id)
      if (caption) form.append('caption', caption)
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

    // Monta os parâmetros das variáveis {{N}} do corpo e o texto já renderizado para exibir no chat
    const varCount = (t.content.match(/\{\{\d+\}\}/g) ?? []).length
    let components: object[] | undefined
    let renderedText = t.content
    if (varCount > 0) {
      const clientName = selectedConv.lead
        ? `${selectedConv.lead.nome}${selectedConv.lead.sobrenome ? ' ' + selectedConv.lead.sobrenome : ''}`
        : (selectedConv.wa_contact_name ?? selectedConv.wa_phone)
      const agentName = displayName(currentUser)
      const now = new Date()
      const resolveVar = (id: string): string => {
        switch (id) {
          case 'nome_cliente':   return clientName
          case 'nome_atendente': return agentName
          case 'data':           return format(now, 'dd/MM/yyyy')
          case 'horario':        return format(now, 'HH:mm')
          default:                return ''
        }
      }
      // Usa a ordem salva na criação do template; se não houver, assume a ordem padrão
      const order = t.variable_order && t.variable_order.length === varCount
        ? t.variable_order
        : ['nome_cliente', 'nome_atendente', 'data', 'horario'].slice(0, varCount)
      const values = order.map(resolveVar)
      components = [{ type: 'body', parameters: values.map(v => ({ type: 'text', text: v })) }]
      renderedText = t.content.replace(/\{\{(\d+)\}\}/g, (_, n) => values[parseInt(n, 10) - 1] ?? `{{${n}}}`)
    }

    setSending(true)
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: selectedConv.id, type: 'template', template_name: t.template_name, language: t.language ?? 'pt_BR', components, rendered_text: renderedText }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        alert(data.error ?? 'Erro ao enviar template')
      }
    } catch {
      alert('Erro ao enviar template')
    } finally { setSending(false) }
  }

  async function handleScheduleSend(content: string, scheduledFor: string) {
    if (!selectedConv) return
    await fetch('/api/whatsapp/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id, content, scheduled_for: scheduledFor }) })
    setChatInput('')
  }

  async function handleScheduleTemplate(t: WaTemplate, scheduledFor: string) {
    if (!selectedConv) return

    if (t.category === 'custom') {
      await fetch('/api/whatsapp/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: selectedConv.id, content: t.content, scheduled_for: scheduledFor }) })
      return
    }

    // Monta os parâmetros das variáveis {{N}} e o texto renderizado, usando a data agendada para data/horário
    const varCount = (t.content.match(/\{\{\d+\}\}/g) ?? []).length
    let components: object[] | undefined
    let renderedText = t.content
    if (varCount > 0) {
      const clientName = selectedConv.lead
        ? `${selectedConv.lead.nome}${selectedConv.lead.sobrenome ? ' ' + selectedConv.lead.sobrenome : ''}`
        : (selectedConv.wa_contact_name ?? selectedConv.wa_phone)
      const agentName = displayName(currentUser)
      const sendAt = new Date(scheduledFor)
      const resolveVar = (id: string): string => {
        switch (id) {
          case 'nome_cliente':   return clientName
          case 'nome_atendente': return agentName
          case 'data':           return format(sendAt, 'dd/MM/yyyy')
          case 'horario':        return format(sendAt, 'HH:mm')
          default:                return ''
        }
      }
      const order = t.variable_order && t.variable_order.length === varCount
        ? t.variable_order
        : ['nome_cliente', 'nome_atendente', 'data', 'horario'].slice(0, varCount)
      const values = order.map(resolveVar)
      components = [{ type: 'body', parameters: values.map(v => ({ type: 'text', text: v })) }]
      renderedText = t.content.replace(/\{\{(\d+)\}\}/g, (_, n) => values[parseInt(n, 10) - 1] ?? `{{${n}}}`)
    }

    const res = await fetch('/api/whatsapp/schedule', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: selectedConv.id,
        type:             'template',
        template_name:    t.template_name,
        language:         t.language ?? 'pt_BR',
        components,
        content:          renderedText,
        scheduled_for:    scheduledFor,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      alert(data.error ?? 'Erro ao agendar template')
    }
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
    if (filterTag !== 'all' && !(c.tags ?? []).some(t => t.tag.id === filterTag)) return false
    const q = convSearch.toLowerCase()
    return !q
      || (c.wa_contact_name ?? c.wa_phone).toLowerCase().includes(q)
      || c.wa_phone.includes(q)
      || (c.lead ? `${c.lead.nome} ${c.lead.sobrenome ?? ''}`.toLowerCase().includes(q) : false)
      || (c.lead_id && (contactNamesByLead[c.lead_id] ?? '').toLowerCase().includes(q))
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
          onNewConv={() => setNewConvOpen(true)} soundEnabled={soundEnabled} onToggleSound={toggleSound}
          unitTags={unitTags} filterTag={filterTag} onFilterTag={setFilterTag}
          onMarkUnread={convId => {
            void fetch('/api/whatsapp/mark-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: convId, unread: true }) })
            setConversations(prev => prev.map(c => c.id === convId ? { ...c, unread_count: 1 } : c))
          }} />

        {/* Chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff', minWidth: 0, position: 'relative' }}>
          {!selectedConv ? <EmptyChatState /> : (
            <>
              <ChatHeader conv={selectedConv} profiles={profiles} queues={queues}
                onStatusChange={updateStatus} onAssignAgent={assignAgent} onAssignQueue={assignQueue}
                contextPanelOpen={contextPanelOpen} onToggleContextPanel={() => setContextPanelOpen(v => !v)} />
              <ConvTagsBar
                convId={selectedConv.id}
                convTags={convTags}
                unitTags={unitTags}
                onTagAdded={tag => {
                  setConvTags(prev => [...prev, tag])
                  setConversations(prev => prev.map(c => c.id === selectedConv.id
                    ? { ...c, tags: [...(c.tags ?? []), { tag }] } : c))
                }}
                onTagRemoved={tagId => {
                  setConvTags(prev => prev.filter(t => t.id !== tagId))
                  setConversations(prev => prev.map(c => c.id === selectedConv.id
                    ? { ...c, tags: (c.tags ?? []).filter(t => t.tag.id !== tagId) } : c))
                }}
              />
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 48px', display: 'flex', flexDirection: 'column', gap: 4, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(37,64,44,0.03) 1px, transparent 0)', backgroundSize: '24px 24px', backgroundColor: '#F2EEE1' }}>
                {!msgsLoaded && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}><Spinner size={22} color="#3E9849" /></div>}
                {msgsLoaded && chatItems.length === 0 && <div style={{ textAlign: 'center', color: '#9AA79C', fontSize: 12, marginTop: 40 }}>Nenhuma mensagem ainda</div>}
                {(() => {
                  const msgByWaId = new Map<string, WaMessage>()
                  const reactionsByWaId = new Map<string, { emoji: string; direction: string }[]>()
                  chatItems.forEach(ci => {
                    if (ci.kind === 'message' && ci.message?.wa_message_id) msgByWaId.set(ci.message.wa_message_id, ci.message)
                    if (ci.kind === 'message' && ci.message?.type === 'reaction' && ci.message.reply_to_wa_message_id && ci.message.content) {
                      const arr = reactionsByWaId.get(ci.message.reply_to_wa_message_id) ?? []
                      arr.push({ emoji: ci.message.content, direction: ci.message.direction })
                      reactionsByWaId.set(ci.message.reply_to_wa_message_id, arr)
                    }
                  })
                  return chatRenderItems.map(item => {
                    if (item.kind === 'date') return <DateSeparator key={item.key} label={item.label} />
                    if (item.kind === 'message' && item.message?.type === 'reaction') return null
                    if (item.kind === 'message') {
                      const reactions = item.message?.wa_message_id ? reactionsByWaId.get(item.message.wa_message_id) : undefined
                      return <ChatBubble key={item.id} msg={item.message!} unitId={selectedConv?.unit_id ?? null} onReply={setReplyTo} quotedMsg={item.message!.reply_to_wa_message_id ? msgByWaId.get(item.message!.reply_to_wa_message_id) ?? null : null} reactions={reactions} />
                    }
                    return <InternalNoteBubble key={item.id} note={item.note!} />
                  })
                })()}
                <div ref={msgsEndRef} />
              </div>
              {replyTo && (
                <div style={{ padding: '8px 14px', background: '#fff', borderTop: '1px solid #E9E5D8', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <div style={{ flex: 1, padding: '6px 10px', borderRadius: 8, background: '#F6F4EC', borderLeft: '3px solid #3E9849', minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: replyTo.direction === 'outbound' ? '#3E9849' : '#71856F' }}>
                      {replyTo.direction === 'outbound' ? 'Você' : 'Cliente'}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: '#71856F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {replyTo.content ?? (replyTo.type === 'image' ? '📷 Imagem' : replyTo.type === 'audio' ? '🎤 Áudio' : replyTo.type === 'video' ? '🎬 Vídeo' : '📎 Anexo')}
                    </p>
                  </div>
                  <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9AA79C', fontSize: 16, lineHeight: 1, flexShrink: 0 }}>×</button>
                </div>
              )}
              <ChatInputComponent value={chatInput} onChange={setChatInput} onSend={handleSend}
                onMediaUpload={handleMediaUpload} onTemplateSend={handleTemplateSend} onScheduleSend={handleScheduleSend} onScheduleTemplate={handleScheduleTemplate}
                templates={templates} quickReplies={quickReplies} sending={sending} mode={inputMode} onModeChange={setInputMode}
                unitId={currentUser.unit_id ?? ''}
                onTemplatesReload={async () => {
                  try {
                    const metaRes  = await fetch('/api/whatsapp/meta-templates')
                    const metaData = await metaRes.json() as { templates?: Array<{ name: string; status: string; language: string; components?: Array<{ type: string; text?: string }>; variable_order?: string[] }> }
                    const metaTmpls: WaTemplate[] = (metaData.templates ?? [])
                      .filter(t => t.status === 'APPROVED')
                      .map(t => ({ id: t.name, name: t.name, content: t.components?.find(c => c.type === 'BODY')?.text ?? '', category: 'meta_api' as const, template_name: t.name, language: t.language, variable_order: t.variable_order ?? [] }))
                    const { data: custom } = await supabase.from('wa_message_templates').select('id,name,content,category,template_name,language').eq('ativo', true).eq('category', 'custom').order('name')
                    setTemplates([...metaTmpls, ...((custom ?? []) as WaTemplate[])])
                  } catch {
                    const { data } = await supabase.from('wa_message_templates').select('id,name,content,category,template_name,language').eq('ativo', true).order('name')
                    setTemplates((data ?? []) as WaTemplate[])
                  }
                }}
                onQuickRepliesReload={() => void supabase.from('wa_quick_replies').select('id,shortcut,content').eq('ativo', true).order('shortcut').then(({ data }) => setQuickReplies((data ?? []) as WaQuickReply[]))}
                isOutside24hWindow={isOutside24hWindow}
                signatureEnabled={signatureEnabled} onToggleSignature={toggleSignature}
                signerName={displayName(currentUser)}
                contactName={selectedConv?.lead ? [selectedConv.lead.nome, selectedConv.lead.sobrenome].filter(Boolean).join(' ') : (selectedConv?.wa_contact_name ?? selectedConv?.wa_phone ?? '')}
              />
            </>
          )}
          {resolveDialogOpen && <ResolveDialog onConfirm={(r, n) => void confirmResolve(r, n)} onCancel={() => setResolveDialogOpen(false)} />}
          {/* Banner de transferência de lead */}
          {transferBanner && (
            <div style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 150, background: '#25402C', color: '#fff', borderRadius: 12, padding: '12px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', gap: 12, minWidth: 360, maxWidth: 500 }}>
              <p style={{ fontSize: 12, margin: 0, flex: 1, lineHeight: 1.5 }}>
                Transferido para <strong>{transferBanner.toName}</strong>. Atualizar o responsável do contato vinculado também?
              </p>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => setTransferBanner(null)} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, border: '1px solid #ffffff44', borderRadius: 7, cursor: 'pointer', background: 'transparent', color: '#ffffffcc' }}>Não</button>
                <button onClick={() => void transferLeadResponsavel(transferBanner.toId)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, border: 'none', borderRadius: 7, cursor: 'pointer', background: '#3E9849', color: '#fff' }}>Sim</button>
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
          borderLeft: contextPanelOpen ? '1px solid #E9E5D8' : 'none',
          background: '#FBFAF4',
          display: 'flex', flexDirection: 'column',
        }}>
          {contextPanelOpen && (
            !selectedConv ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
                <p style={{ fontSize: 12, color: '#9AA79C' }}>Selecione uma conversa</p>
              </div>
            ) : loadingLead ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={20} color="#3E9849" /></div>
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
        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#25402C', margin: '0 0 4px' }}>Encerrar conversa</h3>
        <p style={{ fontSize: 12, color: '#9AA79C', margin: '0 0 18px' }}>Selecione o motivo para alimentar o histórico e relatórios.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 14 }}>
          {Object.entries(RESOLVE_REASONS).map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', cursor: 'pointer',
              border: `1.5px solid ${reason === key ? '#3E9849' : '#EBE7DA'}`, borderRadius: 10,
              background: reason === key ? '#E8F4E6' : '#fff', transition: 'all 0.12s' }}>
              <input type="radio" name="resolve_reason" value={key} checked={reason === key} onChange={() => setReason(key)}
                style={{ accentColor: '#3E9849', width: 15, height: 15, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: reason === key ? 700 : 500, color: reason === key ? '#25402C' : '#71856F' }}>{label}</span>
            </label>
          ))}
        </div>
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Observação adicional (opcional)..." rows={2}
          style={{ width: '100%', resize: 'none', border: '1px solid #EBE7DA', borderRadius: 10, padding: '9px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', background: '#FBFAF4', color: '#25402C' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '10px', fontSize: 13, border: '1px solid #EBE7DA', borderRadius: 10, cursor: 'pointer', background: '#fff', color: '#71856F', fontWeight: 600 }}>Cancelar</button>
          <button onClick={() => reason && onConfirm(reason, note)} disabled={!reason}
            style={{ flex: 2, padding: '10px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 10,
              cursor: reason ? 'pointer' : 'default', background: reason ? '#3E9849' : '#EBE7DA', color: reason ? '#fff' : '#9AA79C', transition: 'all 0.15s' }}>
            Encerrar conversa
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ConvTagsBar ───────────────────────────────────────────────────────────────

// ConvTagsBar extracted to @/components/whatsapp/ConvTagsBar

// ── ConvList ──────────────────────────────────────────────────────────────────

function ConvList({ convs, loaded, selected, onSelect, search, onSearch, filterStatus, onFilterStatus, filterQueue, onFilterQueue, queues, filterMine, onFilterMine, profiles, totalUnread, onNewConv, soundEnabled, onToggleSound, unitTags, filterTag, onFilterTag, onMarkUnread }: {
  convs: WaConversation[]; loaded: boolean; selected: WaConversation | null; onSelect: (c: WaConversation) => void
  search: string; onSearch: (q: string) => void; filterStatus: ConvStatus; onFilterStatus: (s: ConvStatus) => void
  filterQueue: string; onFilterQueue: (q: string) => void; queues: WaQueue[]; filterMine: boolean
  onFilterMine: (v: boolean) => void; profiles: Profile[]; totalUnread: number; onNewConv: () => void
  soundEnabled: boolean; onToggleSound: () => void
  unitTags: ConvTag[]; filterTag: string; onFilterTag: (t: string) => void
  onMarkUnread: (convId: string) => void
}) {
  const [openDrop, setOpenDrop] = useState<'status' | 'queue' | 'tag' | null>(null)
  const filterBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target as Node)) setOpenDrop(null)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [])

  function toggleDrop(name: 'status' | 'queue' | 'tag') {
    setOpenDrop(prev => prev === name ? null : name)
  }

  const STATUS_DOT: Record<string, string> = { all: '#9AA79C', open: '#25D366', pending: '#F59E0B', resolved: '#C05B3A' }
  const activeQueue = queues.find(q => q.id === filterQueue)
  const activeTag   = unitTags.find(t => t.id === filterTag)

  const pillBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
    borderRadius: 99, border: '1px solid #EBE7DA', background: '#F1EFE5',
    fontSize: 11, fontWeight: 600, color: '#71856F', cursor: 'pointer',
    whiteSpace: 'nowrap', userSelect: 'none' as const,
  }
  const pillActive: React.CSSProperties = {
    ...pillBase, background: '#25402C', borderColor: '#25402C', color: '#fff',
  }

  const dropBase: React.CSSProperties = {
    position: 'absolute', top: 'calc(100% + 5px)', left: 0,
    background: '#fff', border: '1px solid #E9E5D8', borderRadius: 10,
    boxShadow: '0 4px 16px rgba(37,64,44,0.10)', padding: 6, zIndex: 300, minWidth: 150,
  }

  const dropItem = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px',
    background: active ? '#E8F4E6' : 'none', border: 'none', cursor: 'pointer',
    borderRadius: 7, fontSize: 12, fontWeight: active ? 600 : 400,
    color: active ? '#3E9849' : '#25402C', textAlign: 'left' as const,
  })

  const ChevronDown = () => (
    <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )

  return (
    <div style={{ width: 316, minWidth: 316, borderRight: '1px solid #E9E5D8', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      {/* Topo: título + ações */}
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #E9E5D8', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 19, fontWeight: 900, color: '#25402C', margin: 0 }}>Conversas</p>
            <p style={{ fontSize: '11.5px', fontWeight: 600, color: '#9AA79C', margin: '2px 0 0' }}>
              {totalUnread > 0 ? `${totalUnread} famílias esperando por você` : 'Tudo em dia'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={onToggleSound} title={soundEnabled ? 'Silenciar' : 'Ativar som'}
              style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #E9E5D8', cursor: 'pointer', background: soundEnabled ? '#E8F4E6' : 'transparent', color: soundEnabled ? '#3E9849' : '#9AA79C', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
              {soundEnabled ? (
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                </svg>
              ) : (
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                </svg>
              )}
            </button>
            <button onClick={onNewConv} title="Nova conversa"
              style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', cursor: 'pointer', background: '#3E9849', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 5px 14px -6px rgba(62,152,73,0.55)' }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: '#9AA79C', pointerEvents: 'none' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="Buscar por nome ou telefone…" value={search} onChange={e => onSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: 32, paddingRight: 10, paddingTop: 8, paddingBottom: 8, fontSize: 12, border: '1px solid #EBE7DA', borderRadius: 999, background: '#F6F4EC', outline: 'none', boxSizing: 'border-box', color: '#25402C' }} />
        </div>

        {/* Filter pill bar */}
        <div ref={filterBarRef} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>

          {/* Status pill */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => toggleDrop('status')} style={filterStatus !== 'all' ? pillActive : pillBase}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[filterStatus] ?? '#9AA79C', flexShrink: 0 }} />
              {filterStatus === 'all' ? 'Status' : STATUS_LABELS[filterStatus]}
              <ChevronDown />
            </button>
            {openDrop === 'status' && (
              <div style={dropBase}>
                {(['all', 'open', 'pending', 'resolved'] as ConvStatus[]).map(s => (
                  <button key={s} onClick={() => { onFilterStatus(s); setOpenDrop(null) }} style={dropItem(filterStatus === s)}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[s], flexShrink: 0 }} />
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Fila pill */}
          {queues.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button onClick={() => toggleDrop('queue')} style={filterQueue !== 'all' ? { ...pillActive, borderColor: activeQueue?.cor ?? '#3E9849', color: activeQueue?.cor ?? '#3E9849', background: (activeQueue?.cor ?? '#3E9849') + '15' } : pillBase}>
                {activeQueue && <span style={{ width: 7, height: 7, borderRadius: '50%', background: activeQueue.cor, flexShrink: 0 }} />}
                {filterQueue === 'all' ? 'Fila' : activeQueue?.nome ?? 'Fila'}
                <ChevronDown />
              </button>
              {openDrop === 'queue' && (
                <div style={dropBase}>
                  <button onClick={() => { onFilterQueue('all'); setOpenDrop(null) }} style={dropItem(filterQueue === 'all')}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9AA79C', flexShrink: 0 }} />
                    Todas
                  </button>
                  <div style={{ height: 1, background: '#EBE7DA', margin: '4px 0' }} />
                  {queues.map(q => (
                    <button key={q.id} onClick={() => { onFilterQueue(q.id); setOpenDrop(null) }} style={dropItem(filterQueue === q.id)}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: q.cor, flexShrink: 0 }} />
                      {q.nome}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tag pill */}
          {unitTags.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button onClick={() => toggleDrop('tag')} style={filterTag !== 'all' ? { ...pillActive, borderColor: activeTag?.color ?? '#3E9849', color: activeTag?.color ?? '#3E9849', background: (activeTag?.color ?? '#3E9849') + '15' } : pillBase}>
                {activeTag && <span style={{ width: 7, height: 7, borderRadius: '50%', background: activeTag.color, flexShrink: 0 }} />}
                {filterTag === 'all' ? 'Tag' : activeTag?.name ?? 'Tag'}
                <ChevronDown />
              </button>
              {openDrop === 'tag' && (
                <div style={dropBase}>
                  <button onClick={() => { onFilterTag('all'); setOpenDrop(null) }} style={dropItem(filterTag === 'all')}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9AA79C', flexShrink: 0 }} />
                    Todas
                  </button>
                  <div style={{ height: 1, background: '#EBE7DA', margin: '4px 0' }} />
                  {unitTags.map(tag => (
                    <button key={tag.id} onClick={() => { onFilterTag(filterTag === tag.id ? 'all' : tag.id); setOpenDrop(null) }} style={dropItem(filterTag === tag.id)}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Minhas — ícone à direita */}
          <button onClick={() => onFilterMine(!filterMine)} title={filterMine ? 'Ver todas' : 'Ver apenas minhas'}
            style={{ marginLeft: 'auto', width: 28, height: 28, borderRadius: 99, border: '1px solid', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s',
              background: filterMine ? '#25402C' : 'transparent', borderColor: filterMine ? '#25402C' : '#EBE7DA', color: filterMine ? '#fff' : '#9AA79C' }}>
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!loaded && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 100 }}><Spinner size={20} color="#3E9849" /></div>}
        {loaded && convs.length === 0 && <div style={{ textAlign: 'center', padding: '32px 16px', color: '#9AA79C', fontSize: 12 }}>Nenhuma conversa</div>}
        {convs.map(conv => {
          const isSelected = selected?.id === conv.id
          const leadName = conv.lead ? [conv.lead.nome, conv.lead.sobrenome].filter(Boolean).join(' ') : null
          const name = leadName ?? conv.wa_contact_name ?? conv.wa_phone
          const sc   = STATUS_COLORS[conv.status] ?? STATUS_COLORS.open
          const assignee = profiles.find(p => p.id === conv.assigned_to)
          const rawPreview = conv.last_message_content?.replace(/\n+/g, ' ') ?? null
          const previewText = rawPreview
            ? (conv.last_message_direction === 'outbound' ? `Você: ${rawPreview}` : rawPreview)
            : null
          const tooltipContent = conv.last_message_content
            ? (conv.last_message_direction === 'outbound' ? `Você: ${conv.last_message_content}` : conv.last_message_content)
            : null
          const previewTitle = tooltipContent
            ? `${name}\n${conv.last_message_at ? formatConvTime(conv.last_message_at) : ''}\n─────\n${tooltipContent.slice(0, 200)}${tooltipContent.length > 200 ? '…' : ''}`
            : name
          return (
            <button key={conv.id} onClick={() => onSelect(conv)} className="group" title={previewTitle}
              style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #F6F4EC', background: isSelected ? '#E8F4E6' : 'transparent', cursor: 'pointer', transition: 'background 0.1s', borderLeft: isSelected ? '3px solid #CDE8CB' : '3px solid transparent' }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                {conv.profile_picture_url ? (
                  <img src={conv.profile_picture_url} alt={name} style={{ width: 42, height: 42, borderRadius: 14, objectFit: 'cover' }} />
                ) : (
                  (() => {
                    const _AVATAR_BG  = ['#D6EBD2', '#DCEFFA', '#F3EBDA'] as const
                    const _AVATAR_INK = ['#3E6B38', '#2A6B99', '#8B6A2F'] as const
                    let _h = 0; for (let i = 0; i < name.length; i++) _h = ((_h << 5) - _h + name.charCodeAt(i)) | 0
                    const _pi = Math.abs(_h) % 3
                    return (
                      <div style={{ width: 42, height: 42, borderRadius: 14, background: _AVATAR_BG[_pi], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: _AVATAR_INK[_pi], letterSpacing: '-0.02em' }}>{name.slice(0, 2).toUpperCase()}</span>
                      </div>
                    )
                  })()
                )}
                <div style={{ position: 'absolute', bottom: 0, right: 0, width: 8, height: 8, borderRadius: '50%', background: sc.text, border: '1.5px solid #fff' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: conv.unread_count > 0 ? 700 : 600, color: '#25402C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  <span style={{ fontSize: 10, color: '#9AA79C', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {conv.last_message_at ? formatConvTime(conv.last_message_at) : ''}
                    {conv.unread_count === 0 && (
                      <span
                        role="button"
                        title="Marcar como não lida"
                        className="group-hover:opacity-100!"
                        onClick={e => { e.stopPropagation(); onMarkUnread(conv.id) }}
                        style={{ opacity: 0, cursor: 'pointer', padding: 2, borderRadius: 4, display: 'inline-flex', transition: 'opacity 0.15s' }}
                      >
                        <svg width="12" height="12" fill="none" stroke="#9AA79C" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginTop: 1 }}>
                  <span style={{ fontSize: 11, color: '#71856F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {previewText ?? (assignee ? `↳ ${displayName(assignee)}` : conv.wa_phone)}
                  </span>
                  {conv.unread_count > 0 && <span style={{ background: '#3E9849', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 6px', flexShrink: 0 }}>{conv.unread_count}</span>}
                </div>
                {(conv.tags ?? []).length > 0 && (
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
                    {(conv.tags ?? []).map(({ tag }) => (
                      <span key={tag.id} style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44`, letterSpacing: '0.02em' }}>
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}
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
    <div style={{ padding: '10px 14px', borderBottom: '1px solid #E9E5D8', background: '#fff', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
      {conv.profile_picture_url ? (
        <img src={conv.profile_picture_url} alt={name} style={{ width: 42, height: 42, borderRadius: 14, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        (() => {
          const _BG  = ['#D6EBD2', '#DCEFFA', '#F3EBDA'] as const
          const _INK = ['#3E6B38', '#2A6B99', '#8B6A2F'] as const
          let _h = 0; for (let i = 0; i < name.length; i++) _h = ((_h << 5) - _h + name.charCodeAt(i)) | 0
          const _pi = Math.abs(_h) % 3
          return (
            <div style={{ width: 42, height: 42, borderRadius: 14, background: _BG[_pi], display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: _INK[_pi], letterSpacing: '-0.02em' }}>{name.slice(0, 2).toUpperCase()}</span>
            </div>
          )
        })()
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 900, color: '#25402C', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
        <p style={{ fontSize: 11, color: '#9AA79C', margin: 0 }}>{conv.wa_phone}</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        {/* Status */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => { setShowStatus(v => !v); setShowAgent(false); setShowQueue(false) }}
            style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 99, border: 'none', cursor: 'pointer', background: sc.bg, color: sc.text }}>
            {STATUS_LABELS[conv.status as ConvStatus] ?? conv.status} ▾
          </button>
          {showStatus && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', border: '1px solid #EBE7DA', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.10)', zIndex: 50, minWidth: 140, overflow: 'hidden' }}>
              {(['open', 'pending', 'resolved'] as const).map(s => (
                <button key={s} onClick={() => { onStatusChange(s); setShowStatus(false) }}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: conv.status === s ? '#FBFAF4' : '#fff', color: STATUS_COLORS[s].text, display: 'block' }}>
                  {STATUS_LABELS[s as ConvStatus]}
                  {s === 'resolved' && <span style={{ fontSize: 9, color: '#9AA79C', display: 'block', fontWeight: 400 }}>Requer motivo</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Agent */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => { setShowAgent(v => !v); setShowStatus(false); setShowQueue(false) }}
            style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 99, border: '1px solid #EBE7DA', cursor: 'pointer', background: '#fff', color: '#71856F' }}>
            {(() => { const p = profiles.find(p => p.id === conv.assigned_to); return p ? displayName(p) : '+ Agente' })()} ▾
          </button>
          {showAgent && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', border: '1px solid #EBE7DA', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.10)', zIndex: 50, minWidth: 160, overflow: 'hidden' }}>
              <button onClick={() => { onAssignAgent(null); setShowAgent(false) }} style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, border: 'none', cursor: 'pointer', background: '#fff', color: '#9AA79C', display: 'block' }}>Sem agente</button>
              {profiles.map(p => (
                <button key={p.id} onClick={() => { onAssignAgent(p.id); setShowAgent(false) }}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, fontWeight: conv.assigned_to === p.id ? 700 : 400, border: 'none', cursor: 'pointer', background: conv.assigned_to === p.id ? '#FBFAF4' : '#fff', color: '#25402C', display: 'block' }}>
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
              style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 99, border: '1px solid #EBE7DA', cursor: 'pointer',
                background: queues.find(q => q.id === conv.queue_id)?.cor ? queues.find(q => q.id === conv.queue_id)!.cor + '22' : '#fff',
                color: queues.find(q => q.id === conv.queue_id)?.cor ?? '#9AA79C' }}>
              {queues.find(q => q.id === conv.queue_id)?.nome ?? 'Fila'} ▾
            </button>
            {showQueue && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', border: '1px solid #EBE7DA', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.10)', zIndex: 50, minWidth: 140, overflow: 'hidden' }}>
                <button onClick={() => { onAssignQueue(null); setShowQueue(false) }} style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, border: 'none', cursor: 'pointer', background: '#fff', color: '#9AA79C', display: 'block' }}>Sem fila</button>
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
          style={{ padding: '5px 7px', border: '1px solid #E9E5D8', borderRadius: 8, background: '#F6F4EC', cursor: 'pointer', lineHeight: 0, color: '#71856F', flexShrink: 0 }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={contextPanelOpen ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── DateSeparator ─────────────────────────────────────────────────────────────

function DateSeparator({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px 0', flexShrink: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#71856F', background: '#fff', borderRadius: 99, padding: '4px 14px', border: '1px solid #EBE7DA', whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(37,64,44,0.06)' }}>
        {label}
      </span>
    </div>
  )
}

// ── ChatBubble / Media ────────────────────────────────────────────────────────

function ChatBubble({ msg, unitId, onReply, quotedMsg, reactions }: { msg: WaMessage; unitId: string | null; onReply?: (msg: WaMessage) => void; quotedMsg?: WaMessage | null; reactions?: { emoji: string; direction: string }[] }) {
  const [bubbleHovered, setBubbleHovered] = useState(false)
  const isOut = msg.direction === 'outbound'
  const failed = isOut && msg.status === 'failed'
  const isText = msg.type === 'text' || msg.type === 'template' || (!msg.media_url && msg.content)
  const isAudio = msg.type === 'audio' && msg.media_url
  const timeColor = failed ? '#C05B3A' : isOut ? '#7FA57F' : '#B4BFB2'

  const timestamp = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: timeColor, whiteSpace: 'nowrap', verticalAlign: 'bottom', lineHeight: '16px' }}>
      {format(new Date(msg.created_at), 'HH:mm')}
      {isOut && <StatusTick status={msg.status} />}
    </span>
  )

  const bubbleMaxWidth = isAudio ? 280 : 'min(70%, 480px)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isOut ? 'flex-end' : 'flex-start' }}
      onMouseEnter={() => setBubbleHovered(true)} onMouseLeave={() => setBubbleHovered(false)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexDirection: isOut ? 'row-reverse' : 'row' }}>
        <div style={{
          maxWidth: bubbleMaxWidth, padding: isAudio ? '6px 10px' : isText ? '6px 8px 6px 10px' : '6px 8px',
          borderRadius: isOut ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
          background: failed ? '#F6DFD5' : isOut ? '#DCF0D3' : '#fff',
          boxShadow: '0 1px 2px rgba(37,64,44,0.06)',
          border: failed ? '1px solid #E8B4B0' : isOut ? 'none' : '1px solid #EBE7DA',
        }}>
          {quotedMsg && (
            <div style={{
              padding: '6px 10px', marginBottom: 4, borderRadius: 8,
              background: isOut ? 'rgba(37,64,44,0.08)' : '#F6F4EC',
              borderLeft: '3px solid #3E9849',
            }}>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: quotedMsg.direction === 'outbound' ? '#3E9849' : '#71856F' }}>
                {quotedMsg.direction === 'outbound' ? 'Você' : 'Cliente'}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#71856F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                {quotedMsg.content ?? (quotedMsg.type === 'image' ? '📷 Imagem' : quotedMsg.type === 'audio' ? '🎤 Áudio' : quotedMsg.type === 'video' ? '🎬 Vídeo' : '📎 Anexo')}
              </p>
            </div>
          )}
          {isText ? (
            <p style={{ margin: 0, fontSize: 13, color: '#25402C', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden' }}>
              <MediaContent msg={msg} isOut={isOut} unitId={unitId} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, float: 'right', marginTop: 2, marginLeft: 8, fontSize: 10, color: timeColor, whiteSpace: 'nowrap', verticalAlign: 'bottom', lineHeight: '16px' }}>{timestamp}</span>
            </p>
          ) : isAudio ? (
            <MediaContent msg={msg} isOut={isOut} unitId={unitId} timestamp={timestamp} />
          ) : (
            <>
              <MediaContent msg={msg} isOut={isOut} unitId={unitId} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>{timestamp}</div>
            </>
          )}
        </div>
        {onReply && !failed && (
          <button
            onClick={() => onReply(msg)}
            title="Responder"
            style={{ padding: 4, borderRadius: 6, border: 'none', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(37,64,44,0.10)', transition: 'opacity 0.15s', flexShrink: 0, opacity: bubbleHovered ? 1 : 0, pointerEvents: bubbleHovered ? 'auto' : 'none' }}
          >
            <svg width="14" height="14" fill="none" stroke="#71856F" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v4M3 10l6 6M3 10l6-6" /></svg>
          </button>
        )}
      </div>
      {reactions && reactions.length > 0 && (
        <div style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start', marginTop: -4 }}>
          <div style={{ display: 'inline-flex', gap: 2, background: '#fff', border: '1px solid #EBE7DA', borderRadius: 99, padding: '1px 6px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            {reactions.map((r, i) => (
              <span key={i} style={{ fontSize: 14, lineHeight: '20px' }}>{r.emoji}</span>
            ))}
          </div>
        </div>
      )}
      {failed && (
        <span style={{ fontSize: 10, color: '#C05B3A', marginTop: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
          <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
          Mensagem não entregue
        </span>
      )}
    </div>
  )
}

function InternalNoteBubble({ note }: { note: WaNote }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: '80%', padding: '8px 14px', borderRadius: 12, background: '#FBF3D9', border: '1.5px dashed #E4D194' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#8A733A', textTransform: 'uppercase' }}>Nota interna</span>
          <span style={{ fontSize: 10, color: '#8A733A' }}>{note.author_name}</span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: '#6B5A2B', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{note.content}</p>
        <p style={{ margin: '4px 0 0', fontSize: 10, color: '#8A733A', textAlign: 'right' }}>{format(new Date(note.created_at), 'HH:mm')}</p>
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


function quoteStatusLabel(s: string): string {
  const map: Record<string, string> = { rascunho: 'Rascunho', enviado: 'Enviado', visualizado: 'Visualizado', aceito: 'Aceito', recusado: 'Recusado', em_negociacao: 'Em Negociação', expirado: 'Expirado' }
  return map[s] ?? s
}

function quoteStatusStyle(s: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    rascunho:      { background: '#F1EFE5', color: '#9AA79C' },
    enviado:       { background: '#E8F4E6', color: '#3E9849' },
    visualizado:   { background: '#FEF4E6', color: '#D17F0E' },
    aceito:        { background: '#E8F4E6', color: '#2E7D32' },
    recusado:      { background: '#FDEBEC', color: '#C05B3A' },
    em_negociacao: { background: '#F3E5F5', color: '#7B1FA2' },
    expirado:      { background: '#FEF4E6', color: '#E65100' },
  }
  return map[s] ?? { background: '#F1EFE5', color: '#9AA79C' }
}

function LeadContextView({ detail, conv, onOpen, onUnlink, onCreateQuote, onSchedule }: {
  detail: LeadDetail; conv: WaConversation
  onOpen: (l: LeadKanban) => void; onUnlink: () => void
  onCreateQuote: () => void; onSchedule: () => void
}) {
  const { lead, latestNote, tasks, contacts, lastQuote } = detail
  const fmtDate = (s: string) => format(new Date(s), "d MMM 'às' HH:mm", { locale: ptBR })

  const cardBase: React.CSSProperties = { background: '#fff', border: '1px solid #EBE7DA', borderRadius: 16, padding: 14 }
  const overline: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: '1px', color: '#9AA79C', textTransform: 'uppercase', marginBottom: 10, marginTop: 0 }
  const familyAvatarColors = [
    { bg: '#E8F4E6', color: '#25402C' },
    { bg: '#FFF3E0', color: '#E65100' },
    { bg: '#F3E5F5', color: '#7B1FA2' },
    { bg: '#E8F5E9', color: '#2E7D32' },
  ]

  const nextTask = tasks[0]

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '18px 16px', gap: 14 }}>

      {/* ── Card Cliente ── */}
      <div style={{ ...cardBase, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '16px 12px', position: 'relative' }}>
        <button onClick={onUnlink} style={{ position: 'absolute', top: 10, right: 12, fontSize: 10, color: '#9AA79C', background: 'none', border: 'none', cursor: 'pointer' }} title="Desvincular">
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
        </button>
        <div style={{ width: 56, height: 56, borderRadius: 999, background: '#E8F4E6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 19, fontWeight: 800, color: '#3E9849' }}>{lead.nome[0]?.toUpperCase()}{lead.sobrenome?.[0]?.toUpperCase() ?? ''}</span>
        </div>
        <p style={{ margin: 0, fontSize: 14.5, fontWeight: 900, color: '#25402C', textAlign: 'center', lineHeight: 1.2 }}>
          {lead.nome}{lead.sobrenome ? ` ${lead.sobrenome}` : ''}
        </p>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#9AA79C', textAlign: 'center' }}>
          {[lead.profissao, lead.cidade].filter(Boolean).join(' · ') || 'Contato vinculado'}
          {contacts.length > 0 && ` · ${contacts.length} dependente${contacts.length > 1 ? 's' : ''}`}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {lead.stage_nome && (
            <span style={{ fontSize: 10, fontWeight: 800, padding: '2.5px 9px', borderRadius: 999, background: (lead.stage_cor ?? '#3E9849') + '18', color: lead.stage_cor ?? '#3E9849' }}>
              {lead.stage_nome}
            </span>
          )}
          {lead.responsavel_nome && (
            <span style={{ fontSize: 10, fontWeight: 800, padding: '2.5px 9px', borderRadius: 999, background: '#E8F4E6', color: '#25402C' }}>
              {lead.responsavel_nome}
            </span>
          )}
        </div>
        {(lead.telefone || lead.email) && (
          <div style={{ width: '100%', borderTop: '1px solid #EBE7DA', paddingTop: 8, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {lead.telefone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="12" height="12" fill="none" stroke="#9AA79C" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                <span style={{ fontSize: 11.5, color: '#71856F' }}>{lead.telefone}</span>
              </div>
            )}
            {lead.email && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="12" height="12" fill="none" stroke="#9AA79C" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                <span style={{ fontSize: 11.5, color: '#71856F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.email}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Card Próxima Tarefa ── */}
      <div style={cardBase}>
        <p style={overline}>Próxima Tarefa</p>
        {nextTask ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: '#E8F4E6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" fill="none" stroke="#3E9849" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#25402C', lineHeight: 1.3 }}>{nextTask.titulo}</p>
              {nextTask.data_limite && (
                <p style={{ margin: '2px 0 0', fontSize: 11.5, color: new Date(nextTask.data_limite) < new Date() ? '#C05B3A' : '#71856F' }}>
                  {fmtDate(nextTask.data_limite)}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 11.5, color: '#9AA79C' }}>Nenhuma tarefa pendente</p>
        )}
        {tasks.length > 1 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tasks.slice(1, 3).map(t => {
              const overdue = t.data_limite && new Date(t.data_limite) < new Date()
              return (
                <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: overdue ? '#C05B3A' : '#F59E0B', flexShrink: 0 }} />
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#25402C', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.titulo}</p>
                  {t.data_limite && <span style={{ fontSize: 10, color: overdue ? '#C05B3A' : '#9AA79C', flexShrink: 0 }}>{format(new Date(t.data_limite), 'd MMM', { locale: ptBR })}</span>}
                </div>
              )
            })}
            {tasks.length > 3 && <p style={{ margin: 0, fontSize: 10, color: '#9AA79C' }}>+{tasks.length - 3} tarefa{tasks.length - 3 > 1 ? 's' : ''}</p>}
          </div>
        )}
      </div>

      {/* ── Card Família ── */}
      <div style={cardBase}>
        <p style={overline}>Família {contacts.length > 0 && <span style={{ color: '#3E9849' }}>({contacts.length})</span>}</p>
        {contacts.length === 0 ? (
          <p style={{ margin: 0, fontSize: 11.5, color: '#9AA79C' }}>Nenhum dependente vinculado</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contacts.map((c, i) => {
              const age = calcAgeCtx(c.data_nascimento)
              const palette = familyAvatarColors[i % familyAvatarColors.length]
              return (
                <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 999, background: palette.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: palette.color }}>{c.nome[0]?.toUpperCase()}</span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#25402C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</p>
                    <p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, color: '#9AA79C' }}>
                      {c.relacao ? c.relacao.charAt(0).toUpperCase() + c.relacao.slice(1) : 'Dependente'}
                      {age !== null && ` · ${age} ano${age !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Card Última Anotação ── */}
      {latestNote && (
        <div style={cardBase}>
          <p style={overline}>Última Anotação</p>
          <p style={{ margin: 0, fontSize: 11.5, color: '#71856F', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{latestNote}</p>
        </div>
      )}

      {/* ── Card Último Orçamento ── */}
      {lastQuote && (
        <div style={cardBase}>
          <p style={overline}>Último Orçamento</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 900, color: '#25402C' }}>
              {lastQuote.total_calculado != null ? `R$ ${lastQuote.total_calculado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 999,
              ...quoteStatusStyle(lastQuote.status),
            }}>
              {quoteStatusLabel(lastQuote.status)}
            </span>
          </div>
          {lastQuote.items_summary && (
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#9AA79C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lastQuote.items_summary}
            </p>
          )}
        </div>
      )}

      {/* ── Ações (rodapé) ── */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
        <button onClick={() => onOpen(lead)}
          style={{ width: '100%', padding: 10, fontSize: 12.5, fontWeight: 800, color: '#fff', background: '#3E9849', border: 'none', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 5px 14px -6px rgba(62,152,73,0.55)' }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          Ver card completo
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCreateQuote}
            style={{ flex: 1, padding: 10, fontSize: 11.5, fontWeight: 800, color: '#71856F', background: '#fff', border: '1px solid #E9E5D8', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Orçamento
          </button>
          <button onClick={onSchedule}
            style={{ flex: 1, padding: 10, fontSize: 11.5, fontWeight: 800, color: '#71856F', background: '#fff', border: '1px solid #E9E5D8', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            Agendar tarefa
          </button>
        </div>
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '18px 16px', gap: 14 }}>
      {!showPanel ? (
        <div style={{ background: '#fff', border: '1px solid #EBE7DA', borderRadius: 16, padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 56, height: 56, borderRadius: 999, background: '#F6F4EC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" fill="none" stroke="#9AA79C" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          </div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#25402C' }}>Sem contato vinculado</p>
          <p style={{ margin: 0, fontSize: 11.5, color: '#9AA79C', textAlign: 'center', lineHeight: 1.4 }}>Vincule esta conversa a um contato do CRM</p>
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <button onClick={onToggle}
              style={{ width: '100%', padding: 10, fontSize: 12.5, fontWeight: 800, color: '#fff', background: '#3E9849', border: 'none', borderRadius: 12, cursor: 'pointer', boxShadow: '0 5px 14px -6px rgba(62,152,73,0.55)' }}>
              Vincular contato
            </button>
            <button onClick={onCreate}
              style={{ width: '100%', padding: 10, fontSize: 12.5, fontWeight: 800, color: '#71856F', background: '#fff', border: '1px solid #E9E5D8', borderRadius: 12, cursor: 'pointer' }}>
              + Criar novo contato
            </button>
          </div>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #EBE7DA', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9AA79C', fontSize: 16, lineHeight: 1, padding: 0 }}>←</button>
            <p style={{ fontSize: 12.5, fontWeight: 800, color: '#25402C', margin: 0 }}>Buscar contato</p>
          </div>
          <input type="text" placeholder="Nome ou telefone..." value={searchQ} onChange={e => onSearch(e.target.value)} autoFocus
            style={{ width: '100%', padding: '8px 12px', fontSize: 12, border: '1px solid #EBE7DA', borderRadius: 10, background: '#FBFAF4', outline: 'none', boxSizing: 'border-box' }} />
          {searching && <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}><Spinner size={18} color="#3E9849" /></div>}
          {!searching && results.map(lead => (
            <button key={lead.id} onClick={() => onLink(lead)}
              style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid #EBE7DA', borderRadius: 12, background: '#fff', cursor: 'pointer' }}>
              <div style={{ width: 32, height: 32, borderRadius: 999, background: '#E8F4E6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#25402C' }}>{lead.nome[0]?.toUpperCase()}</span>
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 800, color: '#25402C', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.nome}{lead.sobrenome ? ` ${lead.sobrenome}` : ''}</p>
                <p style={{ fontSize: 10.5, color: '#9AA79C', margin: 0 }}>{lead.telefone ?? 'Sem telefone'}</p>
              </div>
            </button>
          ))}
          {!searching && searchQ && results.length === 0 && <p style={{ fontSize: 12, color: '#9AA79C', textAlign: 'center', margin: 0 }}>Nenhum resultado</p>}
        </div>
      )}
    </div>
  )
}

// ── EmptyChatState ────────────────────────────────────────────────────────────

function EmptyChatState() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
      <div style={{ width: 56, height: 56, borderRadius: 18, background: '#E8F4E6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="26" height="26" fill="none" stroke="#3E9849" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
      </div>
      <p style={{ fontSize: 14, fontWeight: 700, color: '#25402C', margin: 0 }}>Selecione uma conversa</p>
      <p style={{ fontSize: 12, color: '#9AA79C', margin: 0 }}>Escolha uma conversa à esquerda</p>
    </div>
  )
}

// ── Icon components ───────────────────────────────────────────────────────────


// ── NewConversationModal — extracted to @/components/whatsapp/NewConversationModal

// ── Shared ────────────────────────────────────────────────────────────────────

function StatusTick({ status }: { status: string }) {
  if (status === 'failed') return <span style={{ fontSize: 10, color: '#ff6b6b', fontWeight: 700 }}>!</span>
  const c = status === 'read' ? '#1E86C0' : '#7FA57F'
  if (status === 'sent') return <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5l3 3 5-7" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  return <svg width="18" height="10" viewBox="0 0 18 10" fill="none"><path d="M1 5l3 3 5-7" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M6 5l3 3 5-7" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 5, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 11, color: '#71856F', width: 72, textAlign: 'right', flexShrink: 0, lineHeight: '18px' }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: highlight ? 700 : 400, color: highlight ? '#3E9849' : '#25402C', flex: 1, wordBreak: 'break-all', lineHeight: '18px' }}>{value}</span>
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
