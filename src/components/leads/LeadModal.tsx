'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { format, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import DateTimePicker from '@/components/ui/DateTimePicker'
import MediaContent from '@/components/whatsapp/MediaContent'
import ChatInputComponent from '@/components/whatsapp/ChatInput'
import type { WaTemplate, WaQuickReply, InputMode } from '@/components/whatsapp/wa-types'
import type { WaMessage as SharedWaMessage } from '@/components/whatsapp/wa-types'
import type {
  LeadKanban, FunnelWithStages,
  LeadContact, LeadNote, LeadTask, LeadResponsibleHistory, Profile, ContactRole,
  QuoteStatus, LeadStageHistory,
} from '@/types/database'
import {
  CONTACT_ROLE_LABELS, ARCHIVE_REASONS, ORIGEM_OPTIONS,
  QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS, displayName,
  type ArchiveReason,
} from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { updateLead, archiveLead, restoreLead } from '@/lib/leads'

interface Props {
  lead: LeadKanban | null
  defaultStageId: string
  funnel: FunnelWithStages
  allFunnels: FunnelWithStages[]
  profiles: Profile[]
  currentUser: Profile
  onClose: () => void
  onSaved: () => void
  onLeadPatched?: (patch: Partial<LeadKanban>) => void
}

type Tab = 'Histórico' | 'Anotações' | 'Tarefas' | 'Atendimento' | 'Orçamentos'
const TABS: Tab[] = ['Atendimento', 'Histórico', 'Anotações', 'Tarefas', 'Orçamentos']
const DISABLED_TABS = new Set<Tab>([])

interface WaConversation {
  id:           string
  wa_phone:     string
  status:       string
  unread_count: number
}

type WaMessage = SharedWaMessage

interface LeadQuote {
  id:              string
  numero:          number | null
  status:          QuoteStatus
  total_calculado: number | null
  criado_em:       string
  token_publico:   string
}

interface LeadStageHistoryWithDetails extends LeadStageHistory {
  de_stage:   { nome: string; cor: string } | null
  para_stage: { nome: string; cor: string } | null
  movido_por_profile: { full_name: string } | null
}

type TimelineItem =
  | { kind: 'note';  id: string; ts: string; note: LeadNote }
  | { kind: 'task';  id: string; ts: string; task: LeadTask }
  | { kind: 'resp';  id: string; ts: string; history: LeadResponsibleHistory }
  | { kind: 'stage'; id: string; ts: string; stageHistory: LeadStageHistoryWithDetails }

// Wrapper — never violates hook rules
export default function LeadModal(props: Props) {
  if (!props.lead) return null
  return <LeadDrawer {...props} lead={props.lead} />
}

function LeadDrawer({
  lead, funnel, allFunnels, profiles, currentUser, onClose, onSaved, onLeadPatched,
}: Props & { lead: LeadKanban }) {
  const isArchived = lead.arquivado === true
  const supabase   = createClient()
  const router     = useRouter()

  // ── Animation ──────────────────────────────────────────────────────────────
  const [visible, setVisible] = useState(false)
  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])

  function handleClose() {
    setVisible(false)
    setTimeout(onClose, 280)
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [saving,  setSaving]  = useState(false)

  const [form, setForm] = useState({
    nome:           lead.nome           ?? '',
    sobrenome:      lead.sobrenome      ?? '',
    profissao:      lead.profissao      ?? '',
    cidade:         lead.cidade         ?? '',
    estado:         lead.estado         ?? '',
    pais:           lead.pais           ?? 'Brasil',
    instagram:      lead.instagram      ?? '',
    site:           lead.site           ?? '',
    email:          lead.email          ?? '',
    telefone:       lead.telefone       ?? '',
    origem:         lead.origem         ?? '',
    funnel_id:      lead.funnel_id,
    stage_id:       lead.stage_id,
    responsavel_id: lead.responsavel_id ?? currentUser.id,
  })

  const [negotiation, setNegotiation] = useState({
    valor_proposta:  lead.valor_proposta?.toString()  ?? '',
    modelo:          lead.modelo                      ?? '',
    valor_negociado: lead.valor_negociado?.toString() ?? '',
  })

  const activeFunnel = allFunnels.find(f => f.id === form.funnel_id) ?? funnel
  const activeStages = activeFunnel.stages

  function handleFunnelChange(funnelId: string) {
    const f = allFunnels.find(x => x.id === funnelId)
    setForm(prev => ({ ...prev, funnel_id: funnelId, stage_id: f?.stages[0]?.id ?? prev.stage_id }))
  }

  // ── Consentimento WhatsApp ─────────────────────────────────────────────────
  const [waOptinAt,  setWaOptinAt]  = useState<string | null>(lead.wa_optin_at  ?? null)
  const [waOptoutAt, setWaOptoutAt] = useState<string | null>(lead.wa_optout_at ?? null)

  async function handleRegisterOptin() {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const now = new Date().toISOString()
    const { error } = await supabase.from('leads').update({ wa_optin_at: now }).eq('id', lead.id)
    if (!error) {
      setWaOptinAt(now)
      onLeadPatched?.({ wa_optin_at: now })
    }
  }

  // ── Tab ────────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('Atendimento')

  // ── WhatsApp chat ──────────────────────────────────────────────────────────
  const [waConversation, setWaConversation] = useState<WaConversation | null>(null)
  const [waMessages,     setWaMessages]     = useState<WaMessage[]>([])
  const [waLoaded,       setWaLoaded]       = useState(false)
  const [waInput,        setWaInput]        = useState('')
  const [waSending,      setWaSending]      = useState(false)
  const [waInputMode,    setWaInputMode]    = useState<InputMode>('text')
  const [waTemplates,    setWaTemplates]    = useState<WaTemplate[]>([])
  const [waQuickReplies, setWaQuickReplies] = useState<WaQuickReply[]>([])
  const waMsgsEndRef = useRef<HTMLDivElement>(null)

  // Carrega conversa quando abre a aba Atendimento
  useEffect(() => {
    if (tab !== 'Atendimento' || !lead.telefone || waLoaded) return
    setWaLoaded(false)

    const phoneRaw = lead.telefone.replace(/\D/g, '')
    // normaliza para E.164 brasileiro (adiciona 55 se não tiver)
    const waPhone = phoneRaw.startsWith('55') ? phoneRaw : `55${phoneRaw}`

    supabase
      .from('wa_conversations')
      .select('id, wa_phone, status, unread_count')
      .eq('wa_phone', waPhone)
      .maybeSingle()
      .then(async ({ data: conv }) => {
        if (!conv) { setWaLoaded(true); return }
        setWaConversation(conv as WaConversation)

        // Carrega mensagens (com mídia)
        const { data: msgs } = await supabase
          .from('wa_messages')
          .select('id, direction, type, content, media_url, media_mime_type, template_name, status, created_at, sent_by')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: true })
        if (msgs) setWaMessages(msgs as WaMessage[])

        // Carrega templates e quick replies para o ChatInput
        void supabase.from('wa_message_templates').select('id,name,content,category,template_name,language').eq('ativo', true).order('name')
          .then(({ data }) => setWaTemplates((data ?? []) as WaTemplate[]))
        void supabase.from('wa_quick_replies').select('id,shortcut,content').eq('ativo', true).order('shortcut')
          .then(({ data }) => setWaQuickReplies((data ?? []) as WaQuickReply[]))

        // Zera unread_count via API (admin client garante que o update sempre persiste)
        if (conv.unread_count > 0) {
          void fetch('/api/whatsapp/mark-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: conv.id }) })
        }

        setWaLoaded(true)
      })
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: novas mensagens chegam automaticamente
  useEffect(() => {
    if (!waConversation) return

    const channel = supabase
      .channel(`wa-messages-${waConversation.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wa_messages', filter: `conversation_id=eq.${waConversation.id}` },
        (payload) => {
          const msg = payload.new as WaMessage
          setWaMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev
            return [...prev, msg]
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [waConversation?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll para o fim ao receber novas mensagens
  useEffect(() => {
    waMsgsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [waMessages.length])

  async function handleWaSend() {
    if (!waInput.trim() || !waConversation || waSending) return
    const text = waInput.trim()
    setWaInput('')
    setWaSending(true)
    try {
      if (waInputMode === 'note') {
        await fetch('/api/whatsapp/notes', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ conversation_id: waConversation.id, content: text }),
        })
      } else {
        await fetch('/api/whatsapp/send', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ conversation_id: waConversation.id, content: text }),
        })
      }
    } finally {
      setWaSending(false)
    }
  }

  async function handleWaMediaUpload(file: File) {
    if (!waConversation) return
    setWaSending(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('conversation_id', waConversation.id)
      const res = await fetch('/api/whatsapp/send-media', { method: 'POST', body: fd })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        alert(data.error ?? 'Erro ao enviar mídia')
      }
    } catch {
      alert('Erro ao enviar mídia')
    } finally { setWaSending(false) }
  }

  // Resolve variáveis {{N}} do template usando o nome do lead e do atendente
  function resolveWaTemplateVars(t: WaTemplate, refDate: Date): { components: object[] | undefined; renderedText: string } {
    const varCount = (t.content.match(/\{\{\d+\}\}/g) ?? []).length
    if (varCount === 0) return { components: undefined, renderedText: t.content }
    const clientName = `${lead.nome}${lead.sobrenome ? ' ' + lead.sobrenome : ''}`
    const agentName  = displayName(currentUser)
    const resolveVar = (id: string): string => {
      switch (id) {
        case 'nome_cliente':   return clientName
        case 'nome_atendente': return agentName
        case 'data':           return format(refDate, 'dd/MM/yyyy')
        case 'horario':        return format(refDate, 'HH:mm')
        default:                return ''
      }
    }
    const order = t.variable_order && t.variable_order.length === varCount
      ? t.variable_order
      : ['nome_cliente', 'nome_atendente', 'data', 'horario'].slice(0, varCount)
    const values = order.map(resolveVar)
    return {
      components:   [{ type: 'body', parameters: values.map(v => ({ type: 'text', text: v })) }],
      renderedText: t.content.replace(/\{\{(\d+)\}\}/g, (_, n) => values[parseInt(n, 10) - 1] ?? `{{${n}}}`),
    }
  }

  async function handleWaTemplateSend(t: WaTemplate) {
    if (!waConversation) return
    // Templates custom são texto livre: preenchem o input para edição antes do envio
    if (t.category === 'custom') { setWaInput(t.content); return }

    const { components, renderedText } = resolveWaTemplateVars(t, new Date())
    setWaSending(true)
    try {
      const res = await fetch('/api/whatsapp/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ conversation_id: waConversation.id, type: 'template', template_name: t.template_name ?? t.name, language: t.language ?? 'pt_BR', components, rendered_text: renderedText }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        alert(data.error ?? 'Erro ao enviar template')
      }
    } catch {
      alert('Erro ao enviar template')
    } finally { setWaSending(false) }
  }

  async function handleWaScheduleSend(content: string, scheduledFor: string) {
    if (!waConversation) return
    await fetch('/api/whatsapp/schedule', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ conversation_id: waConversation.id, content, scheduled_for: scheduledFor, type: 'text' }),
    })
  }

  async function handleWaScheduleTemplate(t: WaTemplate, scheduledFor: string) {
    if (!waConversation) return
    // Templates custom são texto livre: agenda como mensagem de texto
    if (t.category === 'custom') {
      await fetch('/api/whatsapp/schedule', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ conversation_id: waConversation.id, content: t.content, scheduled_for: scheduledFor }),
      })
      return
    }
    // Variáveis de data/horário usam a data agendada, não a atual
    const { components, renderedText } = resolveWaTemplateVars(t, new Date(scheduledFor))
    await fetch('/api/whatsapp/schedule', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ conversation_id: waConversation.id, type: 'template', template_name: t.template_name ?? t.name, language: t.language ?? 'pt_BR', components, content: renderedText, scheduled_for: scheduledFor }),
    })
  }

  async function reloadWaTemplates() {
    try {
      const res  = await fetch('/api/whatsapp/meta-templates')
      const data = await res.json() as { templates?: Array<{ name: string; status: string; language: string; components?: Array<{ type: string; text?: string }>; variable_order?: string[] }> }
      const meta: WaTemplate[] = (data.templates ?? [])
        .filter(t => t.status === 'APPROVED')
        .map(t => ({ id: t.name, name: t.name, content: t.components?.find(c => c.type === 'BODY')?.text ?? '', category: 'meta_api' as const, template_name: t.name, language: t.language, variable_order: t.variable_order ?? [] }))
      const { data: custom } = await supabase.from('wa_message_templates').select('id,name,content,category,template_name,language').eq('ativo', true).eq('category', 'custom').order('name')
      setWaTemplates([...meta, ...((custom ?? []) as WaTemplate[])])
    } catch {
      const { data } = await supabase.from('wa_message_templates').select('id,name,content,category,template_name,language').eq('ativo', true).order('name')
      setWaTemplates((data ?? []) as WaTemplate[])
    }
  }

  // Separadores de data para o chat
  type WaRenderItem = WaMessage | { kind: 'date'; label: string; key: string }
  const waRenderItems = useMemo<WaRenderItem[]>(() => {
    const result: WaRenderItem[] = []
    let lastDate = ''
    for (const msg of waMessages) {
      const d = new Date(msg.created_at)
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
      result.push(msg)
    }
    return result
  }, [waMessages])

  // isOutside24hWindow para o chat do modal
  const waIsOutside24h = useMemo(() => {
    if (!waMessages.length) return false
    const lastInbound = [...waMessages].reverse().find(m => m.direction === 'inbound')
    if (!lastInbound) return false
    return Date.now() - new Date(lastInbound.created_at).getTime() > 24 * 60 * 60 * 1000
  }, [waMessages])

  useEffect(() => {
    if (tab !== 'Orçamentos' || quotesLoaded) return
    // Busca por lead_id e, se já convertido, também por client_id
    const filter = `lead_id.eq.${lead.id}`
    supabase
      .from('quotes')
      .select('id, numero, status, total_calculado, criado_em, token_publico')
      .or(filter)
      .order('criado_em', { ascending: false })
      .then(({ data }) => {
        if (data) setQuotes(data as LeadQuote[])
        setQuotesLoaded(true)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // ── Remote data ────────────────────────────────────────────────────────────
  const [contacts,      setContacts]      = useState<LeadContact[]>([])
  const [notes,         setNotes]         = useState<LeadNote[]>([])
  const [tasks,         setTasks]         = useState<LeadTask[]>([])
  const [respHistory,   setRespHistory]   = useState<LeadResponsibleHistory[]>([])
  const [stageHistory,  setStageHistory]  = useState<LeadStageHistoryWithDetails[]>([])
  const [quotes,      setQuotes]      = useState<LeadQuote[]>([])
  const [quotesLoaded, setQuotesLoaded] = useState(false)
  const [copiedQuoteId, setCopiedQuoteId] = useState<string | null>(null)

  useEffect(() => {
    const id = lead.id
    supabase.from('lead_contacts').select('*').eq('lead_id', id).order('created_at')
      .then(({ data }) => { if (data) setContacts(data as LeadContact[]) })
    supabase.from('lead_notes').select('*, autor:profiles(*)').eq('lead_id', id).order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setNotes(data as LeadNote[]) })
    supabase.from('lead_tasks').select('*, responsavel:profiles(*)').eq('lead_id', id)
      .order('concluida').order('data_limite', { nullsFirst: false })
      .then(({ data }) => { if (data) setTasks(data as LeadTask[]) })
    void supabase.from('lead_responsible_history').select('*').eq('lead_id', id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setRespHistory(data as LeadResponsibleHistory[]) })
    void supabase
      .from('lead_stage_history')
      .select('*, de_stage:funnel_stages!de_stage_id(nome,cor), para_stage:funnel_stages!para_stage_id(nome,cor), movido_por_profile:profiles!movido_por(full_name)')
      .eq('lead_id', id)
      .order('criado_em', { ascending: false })
      .then(({ data }) => {
        if (data) setStageHistory(data as LeadStageHistoryWithDetails[])
      })
    supabase.from('lead_negotiation').select('*').eq('lead_id', id).maybeSingle()
      .then(({ data }) => {
        if (data) setNegotiation({
          valor_proposta:  data.valor_proposta?.toString()  ?? '',
          modelo:          data.modelo                      ?? '',
          valor_negociado: data.valor_negociado?.toString() ?? '',
        })
      })
  }, [lead.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Contact CRUD ───────────────────────────────────────────────────────────
  const emptyContact = { nome: '', telefone: '', email: '', cargo: 'outro' as ContactRole, relacao: 'filho' as ContactRole, data_nascimento: '', observacao: '', unit_id: null }
  const [addingContact,     setAddingContact]     = useState(false)
  const [newContact,        setNewContact]        = useState<Omit<LeadContact, 'id' | 'lead_id' | 'created_at'>>(emptyContact)
  const [editingContactId,  setEditingContactId]  = useState<string | null>(null)
  const [editContactDraft,  setEditContactDraft]  = useState<Partial<LeadContact>>({})
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null)

  async function saveNewContact() {
    if (!newContact.nome.trim()) return
    const payload = {
      lead_id:         lead.id,
      unit_id:         newContact.unit_id,
      nome:            newContact.nome.trim(),
      relacao:         newContact.relacao,   // coluna text — aceita 'filho','filha'...
      cargo:           'outro',              // enum legado — mantém compatibilidade
      data_nascimento: newContact.data_nascimento || null,
      observacao:      newContact.observacao?.trim() || null,
      telefone:        null,
      email:           null,
    }
    const { data, error } = await supabase.from('lead_contacts').insert(payload).select().single()
    if (!error && data) {
      setContacts(prev => [...prev, data as LeadContact])
      setNewContact(emptyContact)
      // mantém o form aberto para adicionar mais
    }
  }
  async function saveContactEdit() {
    if (!editingContactId) return
    const patch: Partial<LeadContact> = {
      ...editContactDraft,
      cargo:           'outro' as ContactRole,  // enum legado — mantém compatibilidade
      data_nascimento: editContactDraft.data_nascimento || null,
      observacao:      editContactDraft.observacao?.trim() || null,
    }
    await supabase.from('lead_contacts').update(patch).eq('id', editingContactId)
    setContacts(prev => prev.map(c => c.id === editingContactId ? { ...c, ...patch } : c))
    setEditingContactId(null)
    setEditContactDraft({})
  }
  async function deleteContact(id: string) {
    await supabase.from('lead_contacts').delete().eq('id', id)
    setContacts(prev => prev.filter(c => c.id !== id))
    setDeletingContactId(null)
  }

  // ── Note CRUD ──────────────────────────────────────────────────────────────
  const [newNote,        setNewNote]        = useState('')
  const [addingNote,     setAddingNote]     = useState(false)
  const [editingNoteId,  setEditingNoteId]  = useState<string | null>(null)
  const [editNoteText,   setEditNoteText]   = useState('')
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null)

  async function handleAddNote() {
    if (!newNote.trim()) return
    setAddingNote(true)
    try {
      const { data } = await supabase.from('lead_notes')
        .insert({ lead_id: lead.id, conteudo: newNote.trim(), autor_id: currentUser.id })
        .select('*, autor:profiles(*)').single()
      if (data) { setNotes(prev => [data as LeadNote, ...prev]); setNewNote('') }
    } finally { setAddingNote(false) }
  }
  async function handleSaveNote(id: string) {
    const { data } = await supabase.from('lead_notes')
      .update({ conteudo: editNoteText.trim(), editado_em: new Date().toISOString() })
      .eq('id', id).select('*, autor:profiles(*)').single()
    if (data) setNotes(prev => prev.map(n => n.id === id ? data as LeadNote : n))
    setEditingNoteId(null)
  }
  async function handleDeleteNote(id: string) {
    await supabase.from('lead_notes').delete().eq('id', id)
    setNotes(prev => prev.filter(n => n.id !== id))
    setDeletingNoteId(null)
  }

  // ── Task CRUD ──────────────────────────────────────────────────────────────
  const [newTask,        setNewTask]        = useState({ titulo: '', data_limite: '', responsavel_id: currentUser.id })
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null)

  async function handleAddTask() {
    if (!newTask.titulo.trim()) return
    const { data } = await supabase.from('lead_tasks')
      .insert({ lead_id: lead.id, titulo: newTask.titulo.trim(), responsavel_id: newTask.responsavel_id || currentUser.id, data_limite: newTask.data_limite || null })
      .select('*, responsavel:profiles(*)').single()
    if (data) { setTasks(prev => [data as LeadTask, ...prev]); setNewTask({ titulo: '', data_limite: '', responsavel_id: currentUser.id }) }
  }
  async function handleToggleTask(task: LeadTask) {
    const { data } = await supabase.from('lead_tasks')
      .update({ concluida: !task.concluida, updated_at: new Date().toISOString() }).eq('id', task.id)
      .select('*, responsavel:profiles(*)').single()
    if (data) setTasks(prev => prev.map(t => t.id === task.id ? data as LeadTask : t))
  }
  async function handleDeleteTask(id: string) {
    await supabase.from('lead_tasks').delete().eq('id', id)
    setTasks(prev => prev.filter(t => t.id !== id))
    setDeletingTaskId(null)
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!form.nome.trim()) return
    setSaving(true)
    try {
      const previousStageId = lead.stage_id
      await updateLead(lead.id, { ...form, responsavel_id: form.responsavel_id || null })

      // Registrar mudança de stage via SECURITY DEFINER (bypassa RLS)
      console.log('[modal handleSave] stage check:', { previousStageId, newStageId: form.stage_id })
      if (previousStageId && form.stage_id && previousStageId !== form.stage_id) {
        const { error: rpcErr } = await supabase.rpc('record_stage_history', {
          p_lead_id:    lead.id,
          p_de_stage:   previousStageId,
          p_para_stage: form.stage_id,
          p_movido_por: currentUser.id,
        })
        if (rpcErr) console.error('[modal handleSave] record_stage_history falhou:', rpcErr)
        else        console.log('[modal handleSave] histórico registrado')
      }
      if (negotiation.valor_proposta || negotiation.modelo || negotiation.valor_negociado) {
        await supabase.from('lead_negotiation').upsert({
          lead_id:         lead.id,
          valor_proposta:  negotiation.valor_proposta  ? parseFloat(negotiation.valor_proposta)  : null,
          modelo:          negotiation.modelo          || null,
          valor_negociado: negotiation.valor_negociado ? parseFloat(negotiation.valor_negociado) : null,
        }, { onConflict: 'lead_id' })
      }
      onSaved()
      setEditing(false)
    } finally { setSaving(false) }
  }

  // ── Convert to client ──────────────────────────────────────────────────────
  const [isConverted,  setIsConverted]  = useState<boolean>(lead.is_converted)
  const [converting,   setConverting]   = useState(false)
  const [convertError, setConvertError] = useState('')

  async function handleConvert() {
    if (isConverted || converting) return
    setConverting(true)
    setConvertError('')
    try {
      const { error } = await supabase
        .from('leads')
        .update({ is_converted: true })
        .eq('id', lead.id)
      if (error) throw new Error(error.message)
      setIsConverted(true)
      onSaved()
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : 'Erro ao converter. Tente novamente.')
    } finally {
      setConverting(false)
    }
  }

  // ── Archive ────────────────────────────────────────────────────────────────
  const [archiveModal,  setArchiveModal]  = useState(false)
  const [archiveReason, setArchiveReason] = useState<ArchiveReason | ''>('')
  const [archiveCustom, setArchiveCustom] = useState('')
  const [archiveSaving, setArchiveSaving] = useState(false)

  async function handleArchive() {
    if (!archiveReason) return
    const motivo = archiveReason === 'Outro' ? `Outro: ${archiveCustom.trim() || '—'}` : archiveReason
    setArchiveSaving(true)
    try { await archiveLead(lead.id, motivo); onSaved(); handleClose() }
    finally { setArchiveSaving(false) }
  }
  async function handleRestore() {
    await restoreLead(lead.id)
    onSaved()
    handleClose()
  }

  // ── Timeline ───────────────────────────────────────────────────────────────
  const timeline: TimelineItem[] = [
    ...notes.map(n  => ({ kind: 'note'  as const, id: n.id, ts: n.created_at,  note: n })),
    ...tasks.filter(t => t.concluida).map(t => ({ kind: 'task' as const, id: t.id, ts: t.updated_at, task: t })),
    ...respHistory.map(h  => ({ kind: 'resp'  as const, id: h.id,  ts: h.created_at,  history: h })),
    ...stageHistory.map(h => ({ kind: 'stage' as const, id: h.id,  ts: h.criado_em,   stageHistory: h })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

  // ── Derived ────────────────────────────────────────────────────────────────
  const pendingTasks   = tasks.filter(t => !t.concluida).length
  const fmtCurrency    = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  const phone          = (form.telefone ?? '').replace(/\D/g, '')
  const currentStage   = activeStages.find(s => s.id === form.stage_id)
  const stageNome      = currentStage?.nome      ?? lead.stage_nome
  const stageCor       = currentStage?.cor       ?? lead.stage_cor ?? '#64748b'
  const responsavelNome = profiles.find(p => p.id === form.responsavel_id)?.full_name ?? lead.responsavel_nome

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'rgba(37,64,44,0.35)', backdropFilter: 'blur(3px)' }}
        onClick={handleClose}
      />

      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 bottom-0 z-50 flex w-full sm:w-[85%] max-w-5xl transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ borderRadius: '22px 0 0 22px', overflow: 'hidden', boxShadow: '-24px 0 60px -20px rgba(30,51,35,0.5)', background: '#F6F4EC' }}
      >

        {/* ════ LEFT PANEL ════ */}
        <div className="hidden sm:flex flex-col shrink-0" style={{ width: '340px', background: '#FBFAF4', borderRight: '1px solid #E9E5D8', overflowY: 'auto' }}>

          {/* Cover + avatar */}
          <div className="shrink-0" style={{ position: 'relative' }}>
            <div style={{ background: '#25402C', padding: '24px 22px 46px' }}>
              <span style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '1px', color: '#A8C3AB', textTransform: 'uppercase' }}>Ficha do contato</span>
            </div>
            <div style={{
              position: 'absolute', bottom: '-28px', left: '22px',
              width: 62, height: 62, borderRadius: '50%', border: '4px solid #FBFAF4',
              background: '#D6EBD2', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 21, fontWeight: 900, color: '#35853F' }}>
                {lead.nome[0]?.toUpperCase() ?? '?'}
              </span>
            </div>
          </div>

          {/* Identity */}
          <div style={{ padding: '36px 22px 0' }}>
            <p style={{ fontSize: 19, fontWeight: 900, color: '#25402C', margin: 0 }}>
              {form.nome}{form.sobrenome ? ` ${form.sobrenome}` : ''}
            </p>
            {stageNome && (
              <span style={{ display: 'inline-block', marginTop: 6, fontSize: '10.5px', fontWeight: 800, padding: '3px 11px', borderRadius: 999, background: '#E8F4E6', color: '#35853F' }}>
                {stageNome}
              </span>
            )}
            <p style={{ fontSize: 12, fontWeight: 600, color: '#9AA79C', margin: '6px 0 0' }}>
              {lead.created_at ? `Chegou ${format(new Date(lead.created_at), "d MMM", { locale: ptBR })}` : ''}
              {form.origem ? ` pelo ${form.origem}` : ''}
              {contacts.length === 0 ? ' · ainda sem paciente vinculado' : ` · ${contacts.length} paciente${contacts.length > 1 ? 's' : ''}`}
            </p>
          </div>

          {/* Actions row */}
          <div style={{ padding: '14px 22px 0', display: 'flex', gap: 8 }}>
            {!editing ? (
              <>
                <button
                  onClick={() => setEditing(true)}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid #E9E5D8', borderRadius: 11, padding: 10, fontSize: '13px', fontWeight: 700, color: '#71856F', cursor: 'pointer', background: 'transparent', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#E8F4E6'; e.currentTarget.style.color = '#35853F'; e.currentTarget.style.borderColor = '#C8D9C4' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#71856F'; e.currentTarget.style.borderColor = '#E9E5D8' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
                  Editar dados
                </button>
                {!isArchived && (
                  <button
                    onClick={() => setArchiveModal(true)}
                    title="Arquivar contato"
                    style={{ width: 40, height: 40, borderRadius: 11, border: '1px solid #E9E5D8', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9AA79C', transition: 'all 0.15s', flexShrink: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#C4534A'; e.currentTarget.style.borderColor = '#E8B4B0'; e.currentTarget.style.background = '#FDF1F2' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.borderColor = '#E9E5D8'; e.currentTarget.style.background = 'transparent' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4"/></svg>
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.nome.trim()}
                  style={{ flex: 1, padding: 10, fontSize: 13, fontWeight: 800, color: '#fff', background: '#3E9849', border: 'none', borderRadius: 11, cursor: saving ? 'wait' : 'pointer', opacity: saving || !form.nome.trim() ? 0.5 : 1, boxShadow: '0 5px 14px -6px rgba(62,152,73,0.55)' }}
                >
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  style={{ flex: 1, padding: 10, fontSize: 13, fontWeight: 700, color: '#71856F', background: 'transparent', border: '1px solid #E9E5D8', borderRadius: 11, cursor: 'pointer' }}
                >
                  Cancelar
                </button>
              </>
            )}
          </div>

          {/* Scrollable body */}
          <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {editing ? (
              /* ── Edit mode ── */
              <>
                <LeftSection title="Identificação">
                  <F label="Nome *"    value={form.nome}      onChange={v => setForm(f => ({ ...f, nome: v }))} autoFocus />
                  <F label="Sobrenome" value={form.sobrenome} onChange={v => setForm(f => ({ ...f, sobrenome: v }))} />
                  <F label="Profissão" value={form.profissao} onChange={v => setForm(f => ({ ...f, profissao: v }))} />
                </LeftSection>
                <LeftSection title="Contato">
                  <F label="Telefone"  value={form.telefone}  onChange={v => setForm(f => ({ ...f, telefone: v }))} />
                  <F label="E-mail"    value={form.email}     onChange={v => setForm(f => ({ ...f, email: v }))} type="email" />
                  <F label="Instagram" value={form.instagram} onChange={v => setForm(f => ({ ...f, instagram: v }))} placeholder="@usuario" />
                  <F label="Site"      value={form.site}      onChange={v => setForm(f => ({ ...f, site: v }))} placeholder="https://" />
                </LeftSection>
                <LeftSection title="Localização">
                  <F label="Cidade" value={form.cidade} onChange={v => setForm(f => ({ ...f, cidade: v }))} />
                  <F label="Estado" value={form.estado} onChange={v => setForm(f => ({ ...f, estado: v }))} />
                  <F label="País"   value={form.pais}   onChange={v => setForm(f => ({ ...f, pais: v }))} />
                </LeftSection>
                <LeftSection title="Negócio">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Origem</label>
                    <select value={form.origem} onChange={e => setForm(f => ({ ...f, origem: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                      <option value="">Selecionar...</option>
                      {ORIGEM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Funil</label>
                    <select value={form.funnel_id} onChange={e => handleFunnelChange(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                      {allFunnels.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Etapa</label>
                    <select value={form.stage_id} onChange={e => setForm(f => ({ ...f, stage_id: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                      {activeStages.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Responsável</label>
                    <select value={form.responsavel_id} onChange={e => setForm(f => ({ ...f, responsavel_id: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                      <option value="">Sem responsável</option>
                      {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                  </div>
                </LeftSection>
              </>
            ) : (
              /* ── View mode ── */
              <>
                {/* CONTATO card */}
                <WarmCard title="Contato">
                  {phone ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: '#E8F4E6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="#35853F"><path d="M12 2a10 10 0 0 0-8.6 15l-1.4 5 5.1-1.3A10 10 0 1 0 12 2zm5.3 13.9c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1-.4-.1-1-.3-1.6-.6-2.9-1.2-4.7-4-4.9-4.3-.1-.2-1.1-1.5-1.1-2.8s.7-2 .9-2.2c.2-.2.5-.3.6-.3h.5c.2 0 .4 0 .6.5l.7 1.8c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.5l.8 1.3c.5.7 1.1 1.1 1.7 1.5.2.1.4.1.5-.1l.6-.7c.2-.2.3-.2.5-.1l1.6.8c.3.1.4.2.5.3 0 .2 0 .8-.2 1.3z"/></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#25402C' }}>{form.telefone}</p>
                        <p style={{ margin: 0, fontSize: 11, color: '#9AA79C' }}>WhatsApp · Brasil</p>
                      </div>
                      <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99, background: '#E8F4E6', color: '#35853F', textDecoration: 'none', transition: 'background 0.15s' }}
                      >Ligar</a>
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: '#9AA79C', fontStyle: 'italic', margin: 0 }}>Sem contato cadastrado</p>
                  )}
                  {form.email && (
                    <div style={{ marginTop: 8 }}>
                      <InfoRow label="E-mail"><a href={`mailto:${form.email}`} style={{ color: '#3E9849', textDecoration: 'none', fontSize: 12 }}>{form.email}</a></InfoRow>
                    </div>
                  )}
                </WarmCard>

                {/* SOBRE ESTE CONTATO card */}
                <WarmCard title="Sobre este contato">
                  <InfoRow label="Cadastrado">
                    <span>{format(new Date(lead.created_at), "d MMM yyyy", { locale: ptBR })}</span>
                  </InfoRow>
                  {form.origem && (
                    <InfoRow label="Origem">
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 99, background: '#E8F4E6', color: '#35853F' }}>{form.origem}</span>
                    </InfoRow>
                  )}
                  <InfoRow label="Responsável">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {lead.responsavel_avatar ? (
                        <img src={lead.responsavel_avatar} alt="" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#D6EBD2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: 9, fontWeight: 800, color: '#3E6B38' }}>{(responsavelNome ?? '?')[0]?.toUpperCase()}</span>
                        </div>
                      )}
                      <span>{responsavelNome ? responsavelNome.split(' ')[0] : 'Sem responsável'}</span>
                    </div>
                  </InfoRow>
                  {form.profissao && <InfoRow label="Profissão"><span>{form.profissao}</span></InfoRow>}
                  {(form.cidade || form.estado) && (
                    <InfoRow label="Local"><span>{[form.cidade, form.estado].filter(Boolean).join(', ')}</span></InfoRow>
                  )}
                  {lead.campanha_id && (
                    <InfoRow label="Campanha">
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#EDE9FE', color: '#6D28D9' }}>origem: campanha</span>
                    </InfoRow>
                  )}
                  <InfoRow label="WhatsApp">
                    {waOptoutAt ? (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#FEE2E2', color: '#B91C1C' }}>Bloqueado em {format(new Date(waOptoutAt), "d MMM yyyy", { locale: ptBR })}</span>
                    ) : waOptinAt ? (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#DCFCE7', color: '#166534' }}>Autorizado desde {format(new Date(waOptinAt), "d MMM yyyy", { locale: ptBR })}</span>
                    ) : (
                      <button onClick={() => void handleRegisterOptin()}
                        style={{ fontSize: 11, color: '#3E9849', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                        Autorizar manualmente
                      </button>
                    )}
                  </InfoRow>
                </WarmCard>
              </>
            )}

            {/* ── Pacientes vinculados ── */}
            <div style={{ background: '#fff', border: '1px solid #EBE7DA', borderRadius: 16, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.09em', color: '#9AA79C', textTransform: 'uppercase' }}>Pacientes</span>
                {!addingContact && (
                  <button onClick={() => setAddingContact(true)} style={{ fontSize: '11.5px', fontWeight: 800, color: '#3E9849', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Adicionar</button>
                )}
              </div>

              {addingContact && (
                <div className="border border-violet-200 rounded-xl p-3 bg-violet-50 space-y-2 mb-2">
                  <F label="Nome *" value={newContact.nome} onChange={v => setNewContact(c => ({ ...c, nome: v }))} />
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Relação</label>
                      <select value={newContact.relacao} onChange={e => setNewContact(c => ({ ...c, relacao: e.target.value as ContactRole }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white">
                        {Object.entries(CONTACT_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Data de nascimento</label>
                      <input type="date" value={newContact.data_nascimento ?? ''} onChange={e => setNewContact(c => ({ ...c, data_nascimento: e.target.value }))}
                        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white" />
                    </div>
                  </div>
                  <F label="Observações (alergias, condições...)" value={newContact.observacao ?? ''} onChange={v => setNewContact(c => ({ ...c, observacao: v }))} />
                  <div className="flex gap-2">
                    <button onClick={saveNewContact} disabled={!newContact.nome.trim()} className="flex-1 py-1.5 text-xs bg-violet-500 text-white rounded-lg hover:bg-violet-600 disabled:opacity-50 font-medium">Salvar</button>
                    <button onClick={() => { setAddingContact(false); setNewContact(emptyContact) }} className="flex-1 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-white">Cancelar</button>
                  </div>
                </div>
              )}

              {contacts.length === 0 && !addingContact && (
                <p style={{ fontSize: 12, color: '#9AA79C', fontStyle: 'italic', margin: 0 }}>Nenhum paciente vinculado ainda</p>
              )}

              <div className="space-y-2">
                {contacts.map(c => {
                  const relacao = c.relacao ?? c.cargo
                  const relLabel = CONTACT_ROLE_LABELS[relacao as ContactRole] ?? relacao
                  const idade = calcIdade(c.data_nascimento)
                  return (
                    <div key={c.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                      {editingContactId === c.id ? (
                        <div className="p-3 bg-violet-50 space-y-2">
                          <F label="Nome *" value={editContactDraft.nome ?? ''} onChange={v => setEditContactDraft(d => ({ ...d, nome: v }))} />
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="block text-xs font-medium text-gray-600 mb-1">Relação</label>
                              <select value={editContactDraft.relacao ?? 'filho'} onChange={e => setEditContactDraft(d => ({ ...d, relacao: e.target.value as ContactRole, cargo: e.target.value as ContactRole }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white">
                                {Object.entries(CONTACT_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </div>
                            <div className="flex-1">
                              <label className="block text-xs font-medium text-gray-600 mb-1">Data de nascimento</label>
                              <input type="date" value={editContactDraft.data_nascimento ?? ''} onChange={e => setEditContactDraft(d => ({ ...d, data_nascimento: e.target.value }))}
                                className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white" />
                            </div>
                          </div>
                          <F label="Observações" value={editContactDraft.observacao ?? ''} onChange={v => setEditContactDraft(d => ({ ...d, observacao: v }))} />
                          <div className="flex gap-2 pt-1">
                            <button onClick={saveContactEdit} className="flex-1 py-1 text-xs bg-violet-500 text-white rounded-lg hover:bg-violet-600 font-medium">Salvar</button>
                            <button onClick={() => setEditingContactId(null)} className="flex-1 py-1 text-xs border border-gray-200 rounded-lg hover:bg-white">Cancelar</button>
                          </div>
                        </div>
                      ) : deletingContactId === c.id ? (
                        <div className="p-3 bg-red-50">
                          <p className="text-xs text-red-700 font-medium mb-2">Excluir "{c.nome}"?</p>
                          <div className="flex gap-2">
                            <button onClick={() => deleteContact(c.id)} className="flex-1 py-1 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium">Excluir</button>
                            <button onClick={() => setDeletingContactId(null)} className="flex-1 py-1 text-xs border border-gray-200 rounded-lg hover:bg-white">Não</button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 group">
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0 flex items-start gap-2">
                              <div>
                                <p className="text-xs font-semibold text-gray-900">{c.nome}</p>
                                <p className="text-[11px] text-gray-500">
                                  {relLabel}{idade !== null ? ` · ${idade} ano${idade !== 1 ? 's' : ''}` : ''}{c.data_nascimento ? ` (${formatDtNasc(c.data_nascimento)})` : ''}
                                </p>
                                {c.observacao && <p className="text-[11px] text-amber-700 mt-0.5 bg-amber-50 rounded px-1.5 py-0.5 inline-block">{c.observacao}</p>}
                              </div>
                            </div>
                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <button
                                onClick={() => { setEditingContactId(c.id); setEditContactDraft({ nome: c.nome, relacao: (c.relacao ?? c.cargo) as ContactRole, cargo: (c.relacao ?? c.cargo) as ContactRole, data_nascimento: c.data_nascimento, observacao: c.observacao }) }}
                                className="p-1 text-gray-400 hover:text-violet-500 rounded"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                              </button>
                              <button onClick={() => setDeletingContactId(c.id)} className="p-1 text-gray-400 hover:text-red-500 rounded">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── Pinned footer: Converter ── */}
          <div style={{ marginTop: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {isArchived ? (
              <button
                onClick={handleRestore}
                style={{ width: '100%', padding: 11, fontSize: 13, fontWeight: 800, color: '#3E9849', border: '1px solid #C8D9C4', borderRadius: 12, background: 'transparent', cursor: 'pointer', transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#E8F4E6')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Restaurar contato
              </button>
            ) : isConverted ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 0', fontSize: 12, color: '#35853F', fontWeight: 700 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Convertido em cliente
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  onClick={handleConvert}
                  disabled={converting}
                  style={{
                    width: '100%', padding: 11, fontSize: 13, fontWeight: 800, color: '#fff',
                    background: '#3E9849', border: 'none', borderRadius: 12, cursor: converting ? 'not-allowed' : 'pointer',
                    opacity: converting ? 0.5 : 1, boxShadow: '0 5px 14px -6px rgba(62,152,73,0.55)', transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#35853F')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#3E9849')}
                >
                  {converting ? 'Convertendo...' : 'Converter em cliente'}
                </button>
                {convertError && <p style={{ fontSize: 11, color: '#C4534A', textAlign: 'center', margin: 0 }}>{convertError}</p>}
              </div>
            )}
          </div>
        </div>

        {/* ════ RIGHT PANEL ════ */}
        <div className="flex-1 flex flex-col min-w-0" style={{ background: '#F2EEE1' }}>

          {/* Header */}
          <div className="shrink-0" style={{ background: '#fff', borderBottom: '1px solid #E9E5D8', padding: '18px 28px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 17, fontWeight: 900, margin: 0, color: '#25402C', display: 'flex', alignItems: 'center', gap: 8 }}>
                  Conversa com {lead.nome}
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3E9849', flexShrink: 0 }} />
                </h2>
                <p style={{ fontSize: '11.5px', fontWeight: 700, color: '#9AA79C', margin: '2px 0 0' }}>online agora</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {/* Mobile-only archive/restore */}
                <div className="sm:hidden" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {!isArchived && (
                    <button onClick={() => setArchiveModal(true)} style={{ fontSize: 12, color: '#C4534A', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 8 }}>
                      Arquivar
                    </button>
                  )}
                  {isArchived && (
                    <button onClick={handleRestore} style={{ fontSize: 12, fontWeight: 600, color: '#35853F', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 8 }}>
                      Restaurar
                    </button>
                  )}
                </div>
                <button
                  onClick={handleClose}
                  style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid #E9E5D8', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#9AA79C', flexShrink: 0, transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#C4534A'; e.currentTarget.style.borderColor = '#E8B4B0'; e.currentTarget.style.background = '#FDF1F2' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.borderColor = '#E9E5D8'; e.currentTarget.style.background = 'transparent' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, overflowX: 'auto' }}>
              {TABS.map(t => {
                const disabled = DISABLED_TABS.has(t)
                function handleTabClick() {
                  if (disabled) return
                  setTab(t)
                }
                const isActive = tab === t
                return (
                  <button
                    key={t}
                    onClick={handleTabClick}
                    disabled={disabled}
                    title={disabled ? 'Em breve' : undefined}
                    style={{
                      fontSize: '12.5px', fontWeight: isActive ? 800 : 700, paddingBottom: 12, cursor: disabled ? 'not-allowed' : 'pointer',
                      color: disabled ? '#D4D0C3' : isActive ? '#3E9849' : '#9AA79C',
                      background: 'none', border: 'none', borderBottom: isActive ? '3px solid #3E9849' : '3px solid transparent',
                      display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'color 0.15s',
                    }}
                  >
                    {t}
                    {t === 'Tarefas' && pendingTasks > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 800, minWidth: 18, textAlign: 'center', padding: '1px 6px', borderRadius: 999, background: '#FEF3E2', color: '#C87F1B' }}>{pendingTasks}</span>
                    )}
                    {t === 'Orçamentos' && quotes.length > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 800, minWidth: 18, textAlign: 'center', padding: '1px 6px', borderRadius: 999, background: '#E8F4E6', color: '#35853F' }}>{quotes.length}</span>
                    )}
                    {t === 'Anotações' && notes.length > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 800, minWidth: 18, textAlign: 'center', padding: '1px 6px', borderRadius: 999, background: '#F0EDE4', color: '#9AA79C' }}>{notes.length}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Tab body */}
          <div className="flex-1 overflow-y-auto" style={{ padding: '24px 28px 32px', background: '#F2EEE1' }}>

            {/* ═══ HISTÓRICO ═══ */}
            {tab === 'Histórico' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                {timeline.length === 0 && (
                  <p style={{ fontSize: '13px', color: '#9DB6C7', textAlign: 'center', padding: '48px 0' }}>Nenhuma atividade ainda</p>
                )}
                {timeline.map((item, idx) => {
                  const isLast = idx === timeline.length - 1
                  return (
                    <div key={`${item.kind}-${item.id}`} style={{ display: 'flex', gap: '14px' }}>
                      {/* icon + connector */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <div style={{ width: '34px', height: '34px', flexShrink: 0, borderRadius: '50%', background: '#EAF6FC', color: '#0098DA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {item.kind === 'note' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>}
                          {item.kind === 'task' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 13l4 4L19 7"/></svg>}
                          {item.kind === 'resp' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>}
                          {item.kind === 'stage' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>}
                        </div>
                        {!isLast && <div style={{ flex: 1, width: '2px', background: '#E7EEF4', marginTop: '4px' }} />}
                      </div>

                      {/* content */}
                      <div style={{ flex: 1, paddingBottom: '4px' }}>
                        <div style={{ background: '#fff', border: '1px solid #E9EFF4', borderRadius: '13px', padding: '14px 16px' }}>
                          {item.kind === 'note' && (
                            <>
                              <p style={{ fontSize: '13.5px', color: '#3F5666', marginBottom: '8px' }}>{item.note.autor?.full_name ?? '—'} adicionou uma anotação</p>
                              <p style={{ fontSize: '13.5px', color: '#3F5666', whiteSpace: 'pre-wrap', margin: 0 }}>{item.note.conteudo}</p>
                            </>
                          )}
                          {item.kind === 'task' && (
                            <>
                              <p style={{ fontSize: '13.5px', color: '#3F5666', marginBottom: '8px' }}>Tarefa concluída</p>
                              <p style={{ fontSize: '13.5px', color: '#9DB6C7', textDecoration: 'line-through', margin: 0 }}>{item.task.titulo}</p>
                            </>
                          )}
                          {item.kind === 'resp' && (
                            <p style={{ fontSize: '13.5px', color: '#3F5666', margin: 0 }}>
                              Responsável → <span style={{ fontWeight: 700, color: '#0E2C3D' }}>{profiles.find(p => p.id === item.history.novo_responsavel_id)?.full_name ?? 'Nenhum'}</span>
                            </p>
                          )}
                          {item.kind === 'stage' && (() => {
                            const h       = item.stageHistory
                            const de      = h.de_stage
                            const para    = h.para_stage
                            const quemStr = h.movido_por_profile?.full_name ?? 'Automação'
                            return (
                              <>
                                <p style={{ fontSize: '13.5px', color: '#3F5666', marginBottom: '10px' }}>{quemStr} moveu o contato</p>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                                  {de ? (
                                    <span style={{ fontSize: '12px', fontWeight: 700, padding: '3px 11px', borderRadius: '999px', background: '#EEF1F5', color: '#7A8694' }}>{de.nome}</span>
                                  ) : (
                                    <span style={{ fontSize: '12px', fontWeight: 700, padding: '3px 11px', borderRadius: '999px', background: '#EEF1F5', color: '#7A8694' }}>entrada</span>
                                  )}
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#B6C4D0" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                                  {para && (
                                    <span style={{ fontSize: '12px', fontWeight: 700, padding: '3px 11px', borderRadius: '999px', background: '#0098DA', color: '#fff' }}>{para.nome}</span>
                                  )}
                                </div>
                              </>
                            )
                          })()}
                        </div>
                        <p style={{ fontSize: '12px', color: '#9DB6C7', marginTop: '7px' }}>
                          {format(new Date(item.ts), "d MMM 'às' HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ═══ ANOTAÇÕES ═══ */}
            {tab === 'Anotações' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* New note input */}
                <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch' }}>
                  <textarea
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAddNote() }}
                    placeholder="Nova anotação… (Ctrl+Enter para salvar)"
                    rows={2}
                    style={{ flex: 1, border: '1px solid #E1EEF7', borderRadius: '13px', padding: '14px 16px', fontSize: '13.5px', color: '#0E2C3D', resize: 'none', outline: 'none', fontFamily: 'inherit', minHeight: '54px' }}
                  />
                  <button
                    onClick={handleAddNote}
                    disabled={!newNote.trim() || addingNote}
                    style={{ alignSelf: 'center', background: '#0098DA', color: '#fff', borderRadius: '11px', padding: '11px 24px', fontSize: '13.5px', fontWeight: 700, border: 'none', cursor: addingNote ? 'wait' : 'pointer', boxShadow: '0 6px 16px -6px rgba(0,152,218,0.6)', opacity: !newNote.trim() || addingNote ? 0.5 : 1, transition: 'background 0.15s', whiteSpace: 'nowrap' }}
                    onMouseEnter={e => { if (newNote.trim() && !addingNote) e.currentTarget.style.background = '#0086C2' }}
                    onMouseLeave={e => (e.currentTarget.style.background = '#0098DA')}
                  >
                    {addingNote ? '...' : 'Salvar'}
                  </button>
                </div>

                {notes.length === 0 && <p style={{ fontSize: '13px', color: '#9DB6C7', textAlign: 'center', padding: '32px 0' }}>Nenhuma anotação ainda</p>}

                {notes.map(note => {
                  const isEditing  = editingNoteId  === note.id
                  const isDeleting = deletingNoteId === note.id
                  const isOwn      = note.autor_id  === currentUser.id
                  const authorInitial = (note.autor?.full_name ?? '?')[0].toUpperCase()
                  return (
                    <div key={note.id} className="group" style={{ background: '#fff', border: `1px solid ${isEditing ? '#D0E8F7' : '#E9EFF4'}`, borderRadius: '14px', padding: '20px 22px' }}>
                      {isEditing ? (
                        <>
                          <textarea autoFocus value={editNoteText} onChange={e => setEditNoteText(e.target.value)} rows={4} style={{ width: '100%', border: '1px solid #D0E8F7', borderRadius: '11px', padding: '11px 14px', fontSize: '13.5px', color: '#0E2C3D', resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '12px' }} />
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => handleSaveNote(note.id)} disabled={!editNoteText.trim()} style={{ flex: 1, padding: '9px', fontSize: '13px', fontWeight: 700, background: '#0098DA', color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer' }}>Salvar</button>
                            <button onClick={() => setEditingNoteId(null)} style={{ flex: 1, padding: '9px', fontSize: '13px', fontWeight: 600, background: 'transparent', color: '#3F5666', border: '1px solid #E1EEF7', borderRadius: '10px', cursor: 'pointer' }}>Cancelar</button>
                          </div>
                        </>
                      ) : isDeleting ? (
                        <>
                          <p style={{ fontSize: '13px', fontWeight: 700, color: '#D23B40', marginBottom: '12px' }}>Excluir esta anotação?</p>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => handleDeleteNote(note.id)} style={{ flex: 1, padding: '9px', fontSize: '13px', fontWeight: 700, background: '#E5484D', color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer' }}>Excluir</button>
                            <button onClick={() => setDeletingNoteId(null)} style={{ flex: 1, padding: '9px', fontSize: '13px', fontWeight: 600, background: 'transparent', color: '#3F5666', border: '1px solid #E1EEF7', borderRadius: '10px', cursor: 'pointer' }}>Cancelar</button>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Author header */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#0098DA', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>
                              {authorInitial}
                            </div>
                            <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#3F5666' }}>{note.autor?.full_name ?? '—'}</span>
                            <span style={{ fontSize: '12px', color: '#9DB6C7' }}>· {format(new Date(note.created_at), "d MMM 'às' HH:mm", { locale: ptBR })}{note.editado_em ? ' (editado)' : ''}</span>
                          </div>
                          {/* Content */}
                          <p style={{ fontSize: '13.5px', lineHeight: 1.65, color: '#3F5666', margin: 0, whiteSpace: 'pre-wrap' }}>{note.conteudo}</p>
                          {/* Actions */}
                          {isOwn && (
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ display: 'flex', gap: '6px', marginTop: '12px', justifyContent: 'flex-end' }}>
                              <button onClick={() => { setEditingNoteId(note.id); setEditNoteText(note.conteudo) }} style={{ padding: '4px 8px', fontSize: '11.5px', fontWeight: 600, color: '#1E86C0', background: 'transparent', border: '1px solid #E1EEF7', borderRadius: '7px', cursor: 'pointer' }}>Editar</button>
                              <button onClick={() => setDeletingNoteId(note.id)} style={{ padding: '4px 8px', fontSize: '11.5px', fontWeight: 600, color: '#D23B40', background: 'transparent', border: '1px solid #F5C9CB', borderRadius: '7px', cursor: 'pointer' }}>Excluir</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ═══ TAREFAS ═══ */}
            {tab === 'Tarefas' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Add task form */}
                <div style={{ background: '#fff', border: '1px solid #E9EFF4', borderRadius: '14px', padding: '20px 22px' }}>
                  <p style={{ fontSize: '12.5px', fontWeight: 700, color: '#3F5666', marginBottom: '8px' }}>Tarefa <span style={{ color: '#E5484D' }}>*</span></p>
                  <input
                    type="text"
                    value={newTask.titulo}
                    onChange={e => setNewTask(t => ({ ...t, titulo: e.target.value }))}
                    placeholder="Descreva a tarefa…"
                    style={{ width: '100%', border: '1px solid #E1EEF7', borderRadius: '11px', padding: '11px 14px', fontSize: '13.5px', color: '#0E2C3D', outline: 'none', fontFamily: 'inherit', marginBottom: '14px', boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'flex', gap: '14px', marginBottom: '16px' }}>
                    <div style={{ flex: 1 }}>
                      <DateTimePicker
                        label="Prazo"
                        value={newTask.data_limite}
                        onChange={v => setNewTask(t => ({ ...t, data_limite: v }))}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '12.5px', fontWeight: 700, color: '#3F5666', marginBottom: '8px' }}>Responsável</p>
                      <select
                        value={newTask.responsavel_id}
                        onChange={e => setNewTask(t => ({ ...t, responsavel_id: e.target.value }))}
                        style={{ width: '100%', border: '1px solid #E1EEF7', borderRadius: '11px', padding: '11px 14px', fontSize: '13.5px', color: '#0E2C3D', outline: 'none', fontFamily: 'inherit', background: '#fff', boxSizing: 'border-box' }}
                      >
                        {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={handleAddTask}
                    disabled={!newTask.titulo.trim()}
                    style={{ width: '100%', padding: '12px', fontSize: '13.5px', fontWeight: 700, color: '#fff', background: '#0098DA', border: 'none', borderRadius: '11px', cursor: !newTask.titulo.trim() ? 'not-allowed' : 'pointer', opacity: !newTask.titulo.trim() ? 0.5 : 1, boxShadow: '0 6px 16px -6px rgba(0,152,218,0.6)', transition: 'background 0.15s' }}
                    onMouseEnter={e => { if (newTask.titulo.trim()) e.currentTarget.style.background = '#0086C2' }}
                    onMouseLeave={e => (e.currentTarget.style.background = '#0098DA')}
                  >
                    Adicionar tarefa
                  </button>
                </div>

                {tasks.length === 0 && <p style={{ fontSize: '13px', color: '#9DB6C7', textAlign: 'center', padding: '32px 0' }}>Nenhuma tarefa ainda</p>}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {tasks.map((task) => {
                    const overdue = !task.concluida && task.data_limite && new Date(task.data_limite) < new Date()
                    return (
                      <div key={task.id} className="group" style={{ display: 'flex', alignItems: 'flex-start', gap: '13px', background: task.concluida ? '#F7FAFC' : '#fff', border: `1px solid ${task.concluida ? '#EDF2F6' : '#E9EFF4'}`, borderRadius: '13px', padding: '15px 17px' }}>
                        {/* Checkbox */}
                        <button onClick={() => handleToggleTask(task)} style={{ flexShrink: 0, marginTop: '1px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                          {task.concluida ? (
                            <div style={{ width: '20px', height: '20px', borderRadius: '6px', background: '#4EB46B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M5 12l5 5 9-10"/></svg>
                            </div>
                          ) : (
                            <div style={{ width: '20px', height: '20px', borderRadius: '6px', border: '2px solid #CFD8E1' }} />
                          )}
                        </button>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: '14px', fontWeight: 700, color: task.concluida ? '#9DB6C7' : '#0E2C3D', textDecoration: task.concluida ? 'line-through' : 'none', margin: 0 }}>{task.titulo}</p>
                          {task.observacao_conclusao && (
                            <p style={{ fontSize: '12px', color: '#6B7280', fontStyle: 'italic', margin: '4px 0 0', background: '#F9FAFB', padding: '5px 8px', borderRadius: '6px', borderLeft: '3px solid #E2E8F0' }}>
                              {task.observacao_conclusao}
                            </p>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '5px' }}>
                            {task.data_limite && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: overdue ? 700 : 400, color: overdue ? '#D23B40' : '#9DB6C7' }}>
                                {overdue && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01"/></svg>}
                                {format(new Date(task.data_limite), "d MMM 'às' HH:mm", { locale: ptBR })}
                              </span>
                            )}
                            {task.responsavel && <span style={{ fontSize: '12px', color: '#9DB6C7' }}>{task.responsavel.full_name}</span>}
                          </div>
                        </div>

                        {/* Delete */}
                        {deletingTaskId === task.id ? (
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            <button onClick={() => handleDeleteTask(task.id)} style={{ fontSize: '11.5px', padding: '4px 10px', background: '#E5484D', color: '#fff', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: 700 }}>Excluir</button>
                            <button onClick={() => setDeletingTaskId(null)} style={{ fontSize: '11.5px', padding: '4px 10px', background: 'transparent', color: '#3F5666', border: '1px solid #E1EEF7', borderRadius: '7px', cursor: 'pointer' }}>Não</button>
                          </div>
                        ) : (
                          <button onClick={() => setDeletingTaskId(task.id)} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ flexShrink: 0, background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: '#CFD8E1' }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#D23B40')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#CFD8E1')}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ═══ ORÇAMENTOS ═══ */}
            {tab === 'Orçamentos' && (() => {
              const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

              async function handleCopyLink(q: LeadQuote) {
                const url = `${window.location.origin}/orcamento/ver/${q.token_publico}`
                if (q.status === 'rascunho') {
                  await fetch('/api/orcamento/respond', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: q.token_publico, status: 'enviado' }),
                  })
                  setQuotes(prev => prev.map(x => x.id === q.id ? { ...x, status: 'enviado' as QuoteStatus } : x))
                }
                await navigator.clipboard.writeText(url)
                setCopiedQuoteId(q.id)
                setTimeout(() => setCopiedQuoteId(null), 2000)
              }

              return (
                <div className="space-y-3">
                  {/* Botão novo orçamento — pré-seleciona lead ou cliente */}
                  <a
                    href={`/orcamento?lead_id=${lead.id}`}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#0098DA', color: '#fff', borderRadius: '12px', padding: '13px', fontSize: '14px', fontWeight: 700, textDecoration: 'none', boxShadow: '0 6px 16px -6px rgba(0,152,218,0.6)', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#0086C2')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#0098DA')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14"/></svg>
                    Novo orçamento
                  </a>

                  {!quotesLoaded && (
                    <p className="text-xs text-gray-400 text-center py-8">Carregando...</p>
                  )}

                  {quotesLoaded && quotes.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <p className="text-sm text-gray-500">Nenhum orçamento ainda</p>
                    </div>
                  )}

                  {quotesLoaded && quotes.map(q => (
                    <div
                      key={q.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '14px', background: '#fff', border: '1px solid #E9EFF4', borderRadius: '14px', padding: '15px 18px', transition: 'border-color 0.15s, box-shadow 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#D7E6F0'; e.currentTarget.style.boxShadow = '0 6px 16px -10px rgba(16,44,61,0.2)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#E9EFF4'; e.currentTarget.style.boxShadow = 'none' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                          <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#9DB6C7', fontFamily: 'monospace' }}>
                            #{String(q.numero ?? 0).padStart(4, '0')}
                          </span>
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${QUOTE_STATUS_COLORS[q.status]}`} style={{ fontSize: '12px', fontWeight: 700, padding: '3px 12px', borderRadius: '999px' }}>
                            {QUOTE_STATUS_LABELS[q.status]}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                          <span style={{ fontSize: '17px', fontWeight: 800, color: '#0E2C3D' }}>
                            {q.total_calculado != null ? fmtBRL.format(q.total_calculado) : '—'}
                          </span>
                          <span style={{ fontSize: '12.5px', color: '#9DB6C7' }}>
                            {new Date(q.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', color: '#9DB6C7', flexShrink: 0 }}>
                        <button
                          onClick={() => handleCopyLink(q)}
                          title={copiedQuoteId === q.id ? 'Copiado!' : 'Copiar link do paciente'}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: copiedQuoteId === q.id ? '#4EB46B' : '#9DB6C7', transition: 'color 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = copiedQuoteId === q.id ? '#4EB46B' : '#3F5666')}
                          onMouseLeave={e => (e.currentTarget.style.color = copiedQuoteId === q.id ? '#4EB46B' : '#9DB6C7')}
                        >
                          {copiedQuoteId === q.id ? (
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 13l4 4L19 7"/></svg>
                          ) : (
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>
                          )}
                        </button>
                        <a
                          href={`/orcamento?quote_id=${q.id}`}
                          title="Editar orçamento"
                          style={{ color: '#9DB6C7', transition: 'color 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#3F5666')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#9DB6C7')}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z"/><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/></svg>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* ═══ ATENDIMENTO ═══ */}
            {tab === 'Atendimento' && (() => {
              // Sem telefone cadastrado
              if (!lead.telefone) return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', gap: '16px', textAlign: 'center' }}>
                  <div style={{ width: '58px', height: '58px', borderRadius: '16px', background: '#EAF6FC', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0098DA' }}>
                    <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.5 8.5 0 0 1-12 7.7L3 21l1.8-6A8.5 8.5 0 1 1 21 11.5z"/></svg>
                  </div>
                  <div>
                    <p style={{ fontSize: '15px', fontWeight: 800, color: '#3F5666', margin: '0 0 6px' }}>Telefone não cadastrado</p>
                    <p style={{ fontSize: '13px', color: '#9DB6C7', margin: 0 }}>Cadastre um telefone para iniciar o atendimento via WhatsApp</p>
                  </div>
                  <button
                    onClick={() => { setTab('Histórico'); setEditing(true) }}
                    style={{ padding: '10px 24px', fontSize: '13.5px', fontWeight: 700, background: '#0098DA', color: '#fff', border: 'none', borderRadius: '11px', cursor: 'pointer', boxShadow: '0 6px 16px -6px rgba(0,152,218,0.6)' }}
                  >
                    Editar dados
                  </button>
                </div>
              )

              // Carregando
              if (!waLoaded) return (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0', color: '#9DB6C7', fontSize: '13px' }}>
                  Carregando conversa…
                </div>
              )

              // Sem conversa ainda
              if (!waConversation) return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', gap: '16px', textAlign: 'center' }}>
                  <div style={{ width: '58px', height: '58px', borderRadius: '16px', background: '#EAF6FC', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0098DA' }}>
                    <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.5 8.5 0 0 1-12 7.7L3 21l1.8-6A8.5 8.5 0 1 1 21 11.5z"/></svg>
                  </div>
                  <div>
                    <p style={{ fontSize: '15px', fontWeight: 800, color: '#3F5666', margin: '0 0 6px' }}>Nenhuma conversa ainda</p>
                    <p style={{ fontSize: '13px', color: '#9DB6C7', margin: 0, maxWidth: '280px' }}>Quando este contato enviar uma mensagem para o WhatsApp, a conversa aparecerá aqui automaticamente.</p>
                  </div>
                </div>
              )

              // Chat
              return (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', margin: '-24px -28px -32px', overflow: 'hidden' }}>
                  {/* Messages */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 6, background: '#F2EEE1' }}>
                    {waRenderItems.map(item => {
                      if ('kind' in item && item.kind === 'date') {
                        return (
                          <div key={item.key} style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
                            <span style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C', background: '#fff', borderRadius: 99, padding: '3px 14px', border: '1px solid #EBE7DA' }}>{item.label}</span>
                          </div>
                        )
                      }
                      const msg = item as WaMessage
                      const isOut = msg.direction === 'outbound'
                      const isNote = msg.type === 'note'
                      if (isNote) {
                        return (
                          <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', margin: '4px 16px' }}>
                            <div style={{ background: '#FBF3D9', border: '1px dashed #E4D194', borderRadius: 12, padding: '8px 14px', maxWidth: '80%' }}>
                              <p style={{ margin: 0, fontSize: '11.5px', color: '#8A733A' }}>{msg.content}</p>
                            </div>
                          </div>
                        )
                      }
                      return (
                        <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isOut ? 'flex-end' : 'flex-start' }}>
                          <div style={{
                            maxWidth: '60%',
                            background:   isOut ? '#DCF0D3' : '#fff',
                            borderRadius: isOut ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                            padding:      '8px 12px',
                            boxShadow:    '0 1px 2px rgba(37,64,44,0.07)',
                            border:       isOut ? 'none' : '1px solid #EBE7DA',
                          }}>
                            <div style={{ fontSize: '13.5px', color: isOut ? '#2C4630' : '#35473A' }}>
                              <MediaContent msg={msg} isOut={isOut} unitId={currentUser.unit_id ?? null} />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 3 }}>
                              <span style={{ fontSize: 10, color: isOut ? '#7FA57F' : '#B4BFB2' }}>
                                {format(new Date(msg.created_at), 'HH:mm')}
                              </span>
                              {isOut && (
                                <span style={{ fontSize: 10, color: msg.status === 'read' ? '#1E86C0' : '#7FA57F' }}>
                                  {msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    <div ref={waMsgsEndRef} />
                  </div>

                  {/* Input completo */}
                  <ChatInputComponent
                    value={waInput}
                    onChange={setWaInput}
                    onSend={() => void handleWaSend()}
                    onMediaUpload={handleWaMediaUpload}
                    onTemplateSend={handleWaTemplateSend}
                    onScheduleSend={handleWaScheduleSend}
                    onScheduleTemplate={handleWaScheduleTemplate}
                    templates={waTemplates}
                    quickReplies={waQuickReplies}
                    sending={waSending}
                    mode={waInputMode}
                    onModeChange={setWaInputMode}
                    unitId={currentUser.unit_id ?? ''}
                    onTemplatesReload={reloadWaTemplates}
                    onQuickRepliesReload={() => void supabase.from('wa_quick_replies').select('id,shortcut,content').eq('ativo', true).order('shortcut').then(({ data }) => setWaQuickReplies((data ?? []) as WaQuickReply[]))}
                    isOutside24hWindow={waIsOutside24h}
                    signatureEnabled={false}
                    onToggleSignature={() => {}}
                    signerName=""
                    contactName={[lead.nome, lead.sobrenome].filter(Boolean).join(' ')}
                  />
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* ── Archive modal ── */}
      {archiveModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-0.5">Arquivar contato</h3>
            <p className="text-xs text-gray-500 mb-4">O contato será removido do funil e preservado no banco.</p>
            <p className="text-xs font-medium text-gray-700 mb-2">Motivo da perda *</p>
            <div className="space-y-2 mb-3">
              {ARCHIVE_REASONS.map(reason => (
                <label key={reason} className="flex items-center gap-2.5 cursor-pointer group">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${archiveReason === reason ? 'border-red-500 bg-red-500' : 'border-gray-300 group-hover:border-red-400'}`}>
                    {archiveReason === reason && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <input type="radio" name="archive-reason" value={reason} checked={archiveReason === reason} onChange={() => setArchiveReason(reason)} className="sr-only" />
                  <span className="text-sm text-gray-700">{reason}</span>
                </label>
              ))}
            </div>
            {archiveReason === 'Outro' && (
              <textarea autoFocus value={archiveCustom} onChange={e => setArchiveCustom(e.target.value)} placeholder="Descreva o motivo..." rows={2} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none mb-3" />
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setArchiveModal(false); setArchiveReason(''); setArchiveCustom('') }} className="flex-1 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleArchive}
                disabled={!archiveReason || (archiveReason === 'Outro' && !archiveCustom.trim()) || archiveSaving}
                className="flex-1 py-2 text-sm bg-red-500 text-white rounded-xl hover:bg-red-600 disabled:opacity-50 transition-colors font-medium"
              >
                {archiveSaving ? 'Arquivando...' : 'Arquivar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function WarmCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #EBE7DA', borderRadius: 16, padding: 14 }}>
      <p style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.09em', color: '#9AA79C', marginBottom: 10, textTransform: 'uppercase' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>{children}</div>
    </div>
  )
}

function LeftSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #EBE7DA', borderRadius: 16, padding: 14 }}>
      <p style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.09em', color: '#9AA79C', marginBottom: 12, textTransform: 'uppercase' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>{children}</div>
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#71856F', width: 78, flexShrink: 0 }}>{label}</span>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#25402C', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}

function F({
  label, value, onChange, type = 'text', placeholder, autoFocus,
}: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; placeholder?: string; autoFocus?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300 bg-white"
      />
    </div>
  )
}

function calcIdade(dataNasc: string | null | undefined): number | null {
  if (!dataNasc) return null
  const nasc = new Date(dataNasc)
  if (isNaN(nasc.getTime())) return null
  const hoje = new Date()
  let idade = hoje.getFullYear() - nasc.getFullYear()
  const m = hoje.getMonth() - nasc.getMonth()
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--
  return idade < 0 ? 0 : idade
}

function formatDtNasc(dataNasc: string): string {
  const d = new Date(dataNasc + 'T12:00:00') // evita fuso-horário
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
