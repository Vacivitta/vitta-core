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
import type { WaTemplate, WaQuickReply, InputMode } from '@/components/whatsapp/wa-types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WaQueue     { id: string; nome: string; cor: string; auto_assign?: boolean }
// WaTemplate, WaQuickReply, InputMode imported from @/components/whatsapp/wa-types
interface ConvTag     { id: string; name: string; color: string }

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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#F8FAFB', minWidth: 0, position: 'relative' }}>
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
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {!msgsLoaded && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}><Spinner size={22} color="#0098DA" /></div>}
                {msgsLoaded && chatItems.length === 0 && <div style={{ textAlign: 'center', color: '#B0BEC9', fontSize: 12, marginTop: 40 }}>Nenhuma mensagem ainda</div>}
                {msgsLoaded && chatRenderItems.map(item =>
                  item.kind === 'date'
                    ? <DateSeparator key={item.key} label={item.label} />
                    : item.kind === 'message'
                      ? <ChatBubble key={item.id} msg={item.message!} unitId={selectedConv?.unit_id ?? null} />
                      : <InternalNoteBubble key={item.id} note={item.note!} />
                )}
                <div ref={msgsEndRef} />
              </div>
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

// ── ConvTagsBar ───────────────────────────────────────────────────────────────

function ConvTagsBar({ convId, convTags, unitTags, onTagAdded, onTagRemoved }: {
  convId: string; convTags: ConvTag[]; unitTags: ConvTag[]
  onTagAdded: (tag: ConvTag) => void; onTagRemoved: (tagId: string) => void
}) {
  const [showPicker, setShowPicker] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false)
    }
    if (showPicker) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [showPicker])

  async function addTag(tag: ConvTag) {
    if (convTags.some(t => t.id === tag.id)) { setShowPicker(false); return }
    setSaving(true)
    await fetch('/api/whatsapp/conversation-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: convId, tag_id: tag.id }),
    })
    onTagAdded(tag)
    setSaving(false)
    setShowPicker(false)
  }

  async function removeTag(tagId: string) {
    await fetch(`/api/whatsapp/conversation-tags?conversation_id=${convId}&tag_id=${tagId}`, { method: 'DELETE' })
    onTagRemoved(tagId)
  }

  const availableTags = unitTags.filter(t => !convTags.some(ct => ct.id === t.id))

  if (unitTags.length === 0) return null

  return (
    <div style={{ padding: '6px 14px', borderBottom: '1px solid #F1F4F7', background: '#fff', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
      {convTags.map(tag => (
        <span key={tag.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}>
          {tag.name}
          <button onClick={() => void removeTag(tag.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: tag.color, fontSize: 11, fontWeight: 700, opacity: 0.7 }}>
            ×
          </button>
        </span>
      ))}
      <div style={{ position: 'relative' }} ref={pickerRef}>
        <button onClick={() => setShowPicker(v => !v)} disabled={saving}
          style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, border: '1px dashed #C5D4DE', cursor: 'pointer', background: 'transparent', color: '#8FA0AF', display: 'flex', alignItems: 'center', gap: 3 }}>
          🏷️ {convTags.length === 0 ? 'Adicionar tag' : '+'}
        </button>
        {showPicker && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', border: '1px solid #E8EDF2', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: 8, zIndex: 200, minWidth: 160 }}>
            {availableTags.length === 0 ? (
              <p style={{ fontSize: 11, color: '#B0BEC9', margin: 0, padding: '4px 6px' }}>Todas as tags já foram adicionadas</p>
            ) : availableTags.map(tag => (
              <button key={tag.id} onClick={() => void addTag(tag)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 7, fontSize: 12, color: '#0E2C3D', textAlign: 'left' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F1F4F7' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

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

  const STATUS_DOT: Record<string, string> = { all: '#B0BEC9', open: '#25D366', pending: '#F59E0B', resolved: '#E5484D' }
  const activeQueue = queues.find(q => q.id === filterQueue)
  const activeTag   = unitTags.find(t => t.id === filterTag)

  const pillBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
    borderRadius: 99, border: '1px solid #E8EDF2', background: '#F8FAFB',
    fontSize: 11, fontWeight: 600, color: '#8FA0AF', cursor: 'pointer',
    whiteSpace: 'nowrap', userSelect: 'none' as const,
  }
  const pillActive: React.CSSProperties = {
    ...pillBase, background: '#F0F8FF', borderColor: '#0098DA', color: '#0098DA',
  }

  const dropBase: React.CSSProperties = {
    position: 'absolute', top: 'calc(100% + 5px)', left: 0,
    background: '#fff', border: '1px solid #E8EDF2', borderRadius: 10,
    boxShadow: '0 4px 16px rgba(0,0,0,0.10)', padding: 6, zIndex: 300, minWidth: 150,
  }

  const dropItem = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px',
    background: active ? '#F0F8FF' : 'none', border: 'none', cursor: 'pointer',
    borderRadius: 7, fontSize: 12, fontWeight: active ? 600 : 400,
    color: active ? '#0098DA' : '#0E2C3D', textAlign: 'left' as const,
  })

  const ChevronDown = () => (
    <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )

  return (
    <div style={{ width: 300, minWidth: 300, borderRight: '1px solid #F1F4F7', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      {/* Topo: título + ações */}
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #F1F4F7', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#8FA0AF', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Conversas</p>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {totalUnread > 0 && <span style={{ background: '#25D366', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 7px' }}>{totalUnread}</span>}
            <button onClick={onToggleSound} title={soundEnabled ? 'Silenciar' : 'Ativar som'}
              style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #E8EDF2', cursor: 'pointer', background: soundEnabled ? '#F0F8FF' : '#F8FAFB', color: soundEnabled ? '#0098DA' : '#B0BEC9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
              style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #E8EDF2', cursor: 'pointer', background: '#F0F8FF', color: '#0098DA', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: '#B0BEC9', pointerEvents: 'none' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="Buscar contato..." value={search} onChange={e => onSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: 28, paddingRight: 8, paddingTop: 6, paddingBottom: 6, fontSize: 12, border: '1px solid #E8EDF2', borderRadius: 8, background: '#F8FAFB', outline: 'none', boxSizing: 'border-box' }} />
        </div>

        {/* Filter pill bar */}
        <div ref={filterBarRef} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>

          {/* Status pill */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => toggleDrop('status')} style={filterStatus !== 'all' ? pillActive : pillBase}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[filterStatus] ?? '#B0BEC9', flexShrink: 0 }} />
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
              <button onClick={() => toggleDrop('queue')} style={filterQueue !== 'all' ? { ...pillActive, borderColor: activeQueue?.cor ?? '#0098DA', color: activeQueue?.cor ?? '#0098DA', background: (activeQueue?.cor ?? '#0098DA') + '15' } : pillBase}>
                {activeQueue && <span style={{ width: 7, height: 7, borderRadius: '50%', background: activeQueue.cor, flexShrink: 0 }} />}
                {filterQueue === 'all' ? 'Fila' : activeQueue?.nome ?? 'Fila'}
                <ChevronDown />
              </button>
              {openDrop === 'queue' && (
                <div style={dropBase}>
                  <button onClick={() => { onFilterQueue('all'); setOpenDrop(null) }} style={dropItem(filterQueue === 'all')}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#B0BEC9', flexShrink: 0 }} />
                    Todas
                  </button>
                  <div style={{ height: 1, background: '#F1F4F7', margin: '4px 0' }} />
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
              <button onClick={() => toggleDrop('tag')} style={filterTag !== 'all' ? { ...pillActive, borderColor: activeTag?.color ?? '#0098DA', color: activeTag?.color ?? '#0098DA', background: (activeTag?.color ?? '#0098DA') + '15' } : pillBase}>
                {activeTag && <span style={{ width: 7, height: 7, borderRadius: '50%', background: activeTag.color, flexShrink: 0 }} />}
                {filterTag === 'all' ? 'Tag' : activeTag?.name ?? 'Tag'}
                <ChevronDown />
              </button>
              {openDrop === 'tag' && (
                <div style={dropBase}>
                  <button onClick={() => { onFilterTag('all'); setOpenDrop(null) }} style={dropItem(filterTag === 'all')}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#B0BEC9', flexShrink: 0 }} />
                    Todas
                  </button>
                  <div style={{ height: 1, background: '#F1F4F7', margin: '4px 0' }} />
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
              background: filterMine ? '#0098DA' : 'transparent', borderColor: filterMine ? '#0098DA' : '#E8EDF2', color: filterMine ? '#fff' : '#B0BEC9' }}>
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
          </button>
        </div>
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
          const previewText = conv.last_message_content
            ? (conv.last_message_direction === 'outbound' ? `Você: ${conv.last_message_content}` : conv.last_message_content)
            : null
          const previewTitle = previewText
            ? `${name}\n${conv.last_message_at ? formatConvTime(conv.last_message_at) : ''}\n─────\n${previewText.slice(0, 200)}${previewText.length > 200 ? '…' : ''}`
            : name
          return (
            <button key={conv.id} onClick={() => onSelect(conv)} className="group" title={previewTitle}
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
                  <span style={{ fontSize: 10, color: '#B0BEC9', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {conv.last_message_at ? formatConvTime(conv.last_message_at) : ''}
                    {conv.unread_count === 0 && (
                      <span
                        role="button"
                        title="Marcar como não lida"
                        className="group-hover:opacity-100!"
                        onClick={e => { e.stopPropagation(); onMarkUnread(conv.id) }}
                        style={{ opacity: 0, cursor: 'pointer', padding: 2, borderRadius: 4, display: 'inline-flex', transition: 'opacity 0.15s' }}
                      >
                        <svg width="12" height="12" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginTop: 1 }}>
                  <span style={{ fontSize: 11, color: '#8FA0AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {previewText ?? (assignee ? `↳ ${displayName(assignee)}` : conv.wa_phone)}
                  </span>
                  {conv.unread_count > 0 && <span style={{ background: '#25D366', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 6px', flexShrink: 0 }}>{conv.unread_count}</span>}
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

// ── DateSeparator ─────────────────────────────────────────────────────────────

function DateSeparator({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0', flexShrink: 0 }}>
      <div style={{ flex: 1, height: 1, background: '#F1F4F7' }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: '#A0ADB8', background: '#F4F6F8', borderRadius: 99, padding: '3px 12px', border: '1px solid #EDF0F3', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: '#F1F4F7' }} />
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
