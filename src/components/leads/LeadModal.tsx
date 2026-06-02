'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type {
  LeadKanban, FunnelWithStages,
  LeadContact, LeadNote, LeadTask, LeadResponsibleHistory, Profile, ContactRole,
  QuoteStatus, LeadStageHistory,
} from '@/types/database'
import {
  CONTACT_ROLE_LABELS, ARCHIVE_REASONS, ORIGEM_OPTIONS,
  QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS,
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
}

type Tab = 'Histórico' | 'Anotações' | 'Tarefas' | 'Atendimento' | 'Orçamentos'
const TABS: Tab[] = ['Histórico', 'Anotações', 'Tarefas', 'Atendimento', 'Orçamentos']
const DISABLED_TABS = new Set<Tab>([])

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
  lead, funnel, allFunnels, profiles, currentUser, onClose, onSaved,
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

  function handleOpenAtendimento() {
    const numero = lead.telefone?.replace(/\D/g, '') ?? ''
    setVisible(false)
    setTimeout(() => { onClose(); router.push(`/atendimento?numero=${numero}`) }, 280)
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

  // ── Tab ────────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('Histórico')

  useEffect(() => {
    if (tab !== 'Orçamentos' || quotesLoaded) return
    // Busca por lead_id e, se já convertido, também por client_id
    const filter = clientId
      ? `lead_id.eq.${lead.id},client_id.eq.${clientId}`
      : `lead_id.eq.${lead.id}`
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
  const [addingContact,     setAddingContact]     = useState(false)
  const [newContact,        setNewContact]        = useState<Omit<LeadContact, 'id' | 'lead_id' | 'created_at'>>({ nome: '', telefone: '', email: '', cargo: 'outro', observacao: '', unit_id: null })
  const [editingContactId,  setEditingContactId]  = useState<string | null>(null)
  const [editContactDraft,  setEditContactDraft]  = useState<Partial<LeadContact>>({})
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null)

  async function saveNewContact() {
    if (!newContact.nome.trim()) return
    const { data } = await supabase.from('lead_contacts').insert({ ...newContact, lead_id: lead.id }).select().single()
    if (data) {
      setContacts(prev => [...prev, data as LeadContact])
      setAddingContact(false)
      setNewContact({ nome: '', telefone: '', email: '', cargo: 'outro', observacao: '', unit_id: null })
    }
  }
  async function saveContactEdit() {
    if (!editingContactId) return
    await supabase.from('lead_contacts').update(editContactDraft).eq('id', editingContactId)
    setContacts(prev => prev.map(c => c.id === editingContactId ? { ...c, ...editContactDraft } : c))
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
      .update({ concluida: !task.concluida }).eq('id', task.id)
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
  const [clientId,     setClientId]  = useState<string | null>(lead.client_id)
  const [converting,   setConverting] = useState(false)
  const [convertError, setConvertError] = useState('')

  // Verifica no banco ao abrir — garante que dado stale do pai não engane o estado
  useEffect(() => {
    if (clientId) return
    supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .maybeSingle()
      .then(({ data }) => { if (data) setClientId(data.id) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id])

  async function handleConvert() {
    if (clientId || converting) return
    const unitId = lead.unit_id ?? currentUser.unit_id
    if (!unitId) { setConvertError('Unidade não encontrada. Verifique seu perfil.'); return }

    setConverting(true)
    setConvertError('')
    try {
      // Guard: checar se já existe cliente para este lead
      const { data: existing } = await supabase
        .from('clients')
        .select('id')
        .eq('lead_id', lead.id)
        .maybeSingle()

      if (existing) {
        // Já existe — só atualizar o ponteiro no lead
        await supabase.from('leads').update({ client_id: existing.id }).eq('id', lead.id)
        setClientId(existing.id)
        onSaved()
        return
      }

      const { data: client, error: clientErr } = await supabase
        .from('clients')
        .insert({
          unit_id:   unitId,
          lead_id:   lead.id,
          nome:      lead.nome,
          sobrenome: lead.sobrenome ?? null,
          telefone:  lead.telefone ?? null,
          email:     lead.email    ?? null,
        })
        .select('id')
        .single()

      if (clientErr || !client) throw new Error(clientErr?.message ?? 'Falha ao criar cliente')

      const { error: leadErr } = await supabase
        .from('leads')
        .update({ client_id: client.id })
        .eq('id', lead.id)

      if (leadErr) throw new Error(leadErr.message)

      setClientId(client.id)
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
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />

      {/* Drawer */}
      <div className={`fixed right-0 top-0 bottom-0 z-50 flex w-full sm:w-[85%] max-w-5xl shadow-2xl transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* ════ LEFT PANEL ════ */}
        <div className="hidden sm:flex flex-col w-72 shrink-0 bg-gray-50 border-r border-gray-200 overflow-hidden">

          {/* Avatar + name */}
          <div className="px-5 pt-5 pb-4 border-b border-gray-200 shrink-0">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-sm font-bold text-blue-600">
                {lead.nome[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-gray-900 leading-tight">
                  {form.nome}{form.sobrenome ? ` ${form.sobrenome}` : ''}
                </p>
                {stageNome && (
                  <span
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full inline-block mt-0.5"
                    style={{ backgroundColor: `${stageCor}22`, color: stageCor }}
                  >
                    {stageNome}
                  </span>
                )}
              </div>
            </div>

            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="w-full py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-white hover:border-gray-300 transition-colors font-medium"
              >
                Editar dados
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !form.nome.trim()}
                  className="flex-1 py-1.5 text-xs text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 font-medium transition-colors"
                >
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="flex-1 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-white transition-colors"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

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
                <LeftSection title="Proposta">
                  <F label="Modelo / Serviço"     value={negotiation.modelo}          onChange={v => setNegotiation(n => ({ ...n, modelo: v }))} placeholder="Ex: Plano Anual..." />
                  <F label="Valor proposta (R$)"  value={negotiation.valor_proposta}  onChange={v => setNegotiation(n => ({ ...n, valor_proposta: v }))} type="number" placeholder="0,00" />
                  <F label="Valor negociado (R$)" value={negotiation.valor_negociado} onChange={v => setNegotiation(n => ({ ...n, valor_negociado: v }))} type="number" placeholder="0,00" />
                </LeftSection>
              </>
            ) : (
              /* ── View mode ── */
              <>
                {/* Contact */}
                <LeftSection title="Contato">
                  {phone ? (
                    <InfoRow label="Telefone">
                      <span>{form.telefone}</span>
                      <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer" className="ml-1 text-emerald-500 hover:text-emerald-700" title="WhatsApp">
                        <svg className="w-3.5 h-3.5 inline" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                      </a>
                    </InfoRow>
                  ) : null}
                  {form.email    && <InfoRow label="E-mail"><a href={`mailto:${form.email}`} className="text-blue-500 hover:underline truncate">{form.email}</a></InfoRow>}
                  {form.instagram && <InfoRow label="Instagram"><span>{form.instagram}</span></InfoRow>}
                  {form.site     && <InfoRow label="Site"><a href={form.site} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate">{form.site}</a></InfoRow>}
                  {!phone && !form.email && !form.instagram && !form.site && (
                    <p className="text-xs text-gray-400 italic">Sem contato cadastrado</p>
                  )}
                </LeftSection>

                {(form.cidade || form.estado || form.pais) && (
                  <LeftSection title="Localização">
                    <InfoRow label="Local">
                      <span>{[form.cidade, form.estado, form.pais].filter(Boolean).join(', ')}</span>
                    </InfoRow>
                  </LeftSection>
                )}

                <LeftSection title="Negócio">
                  <InfoRow label="Cadastrado">
                    <span>{format(new Date(lead.created_at), "d MMM yyyy", { locale: ptBR })}</span>
                  </InfoRow>
                  {form.origem && <InfoRow label="Origem"><span>{form.origem}</span></InfoRow>}
                  {form.profissao && <InfoRow label="Profissão"><span>{form.profissao}</span></InfoRow>}
                  <InfoRow label="Responsável">
                    <div className="flex items-center gap-1.5">
                      {lead.responsavel_avatar ? (
                        <img src={lead.responsavel_avatar} alt="" className="w-4 h-4 rounded-full object-cover" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-[8px] font-bold text-blue-600">{(responsavelNome ?? '?')[0]?.toUpperCase()}</span>
                        </div>
                      )}
                      <span>{responsavelNome ?? 'Sem responsável'}</span>
                    </div>
                  </InfoRow>
                  {(lead.valor_negociado != null || lead.valor_proposta != null) && (
                    <InfoRow label="Valor">
                      <span className="text-emerald-600 font-semibold">
                        {fmtCurrency.format(lead.valor_negociado ?? lead.valor_proposta ?? 0)}
                      </span>
                    </InfoRow>
                  )}
                  {lead.modelo && <InfoRow label="Modelo"><span>{lead.modelo}</span></InfoRow>}
                </LeftSection>
              </>
            )}

            {/* ── Linked contacts ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Contatos vinculados</p>
                <button onClick={() => setAddingContact(true)} className="text-xs text-blue-500 hover:text-blue-700 font-medium">+ Adicionar</button>
              </div>

              {addingContact && (
                <div className="border border-blue-200 rounded-xl p-3 bg-blue-50 space-y-2 mb-2">
                  <F label="Nome *"   value={newContact.nome}          onChange={v => setNewContact(c => ({ ...c, nome: v }))} />
                  <F label="Telefone" value={newContact.telefone ?? ''} onChange={v => setNewContact(c => ({ ...c, telefone: v }))} />
                  <F label="E-mail"   value={newContact.email    ?? ''} onChange={v => setNewContact(c => ({ ...c, email: v }))} type="email" />
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Cargo</label>
                    <select value={newContact.cargo} onChange={e => setNewContact(c => ({ ...c, cargo: e.target.value as ContactRole }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                      {Object.entries(CONTACT_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveNewContact} disabled={!newContact.nome.trim()} className="flex-1 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 font-medium">Salvar</button>
                    <button onClick={() => setAddingContact(false)} className="flex-1 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-white">Cancelar</button>
                  </div>
                </div>
              )}

              {contacts.length === 0 && !addingContact && (
                <p className="text-xs text-gray-400 italic">Nenhum contato vinculado</p>
              )}

              <div className="space-y-2">
                {contacts.map(c => (
                  <div key={c.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                    {editingContactId === c.id ? (
                      <div className="p-3 bg-blue-50 space-y-2">
                        <F label="Nome *"   value={editContactDraft.nome     ?? ''} onChange={v => setEditContactDraft(d => ({ ...d, nome: v }))} />
                        <F label="Telefone" value={editContactDraft.telefone ?? ''} onChange={v => setEditContactDraft(d => ({ ...d, telefone: v }))} />
                        <F label="E-mail"   value={editContactDraft.email    ?? ''} onChange={v => setEditContactDraft(d => ({ ...d, email: v }))} type="email" />
                        <div className="flex gap-2 pt-1">
                          <button onClick={saveContactEdit} className="flex-1 py-1 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium">Salvar</button>
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
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-900">{c.nome}</p>
                            <p className="text-[11px] text-gray-500">{CONTACT_ROLE_LABELS[c.cargo]}{c.telefone ? ` · ${c.telefone}` : ''}</p>
                            {c.email && <p className="text-[11px] text-blue-500 truncate">{c.email}</p>}
                          </div>
                          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button
                              onClick={() => { setEditingContactId(c.id); setEditContactDraft({ nome: c.nome, telefone: c.telefone, email: c.email, cargo: c.cargo, observacao: c.observacao }) }}
                              className="p-1 text-gray-400 hover:text-blue-500 rounded"
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
                ))}
              </div>
            </div>

            {/* ── Converter em cliente ── */}
            {!isArchived && (
              <div className="pt-2 border-t border-gray-200">
                {clientId ? (
                  <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-emerald-600 font-medium">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Convertido em cliente
                  </div>
                ) : (
                  <div className="space-y-1">
                    <button
                      onClick={handleConvert}
                      disabled={converting}
                      className="w-full py-2 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 font-medium transition-colors disabled:opacity-50"
                    >
                      {converting ? 'Convertendo...' : 'Converter em cliente'}
                    </button>
                    {convertError && <p className="text-[11px] text-red-500 text-center">{convertError}</p>}
                  </div>
                )}
              </div>
            )}

            {/* ── Archive / Restore ── */}
            <div className="pt-2 border-t border-gray-200">
              {isArchived ? (
                <button onClick={handleRestore} className="w-full py-2 text-xs text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50 font-medium transition-colors">
                  Restaurar lead
                </button>
              ) : (
                <button onClick={() => setArchiveModal(true)} className="w-full py-2 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50 font-medium transition-colors">
                  Arquivar lead
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ════ RIGHT PANEL ════ */}
        <div className="flex-1 flex flex-col bg-white min-w-0">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900 truncate">
                {lead.nome}{lead.sobrenome ? ` ${lead.sobrenome}` : ''}
              </h2>
              {stageNome && (
                <span
                  className="text-[11px] font-medium px-2 py-0.5 rounded-full mt-0.5 inline-block sm:hidden"
                  style={{ backgroundColor: `${stageCor}22`, color: stageCor }}
                >
                  {stageNome}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Mobile-only archive/restore */}
              <div className="sm:hidden flex items-center gap-1.5">
                {!isArchived && (
                  <button onClick={() => setArchiveModal(true)} className="text-xs text-red-500 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors">
                    Arquivar
                  </button>
                )}
                {isArchived && (
                  <button onClick={handleRestore} className="text-xs text-emerald-600 hover:bg-emerald-50 px-2.5 py-1 rounded-lg transition-colors font-medium">
                    Restaurar
                  </button>
                )}
              </div>
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1.5 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-100 px-4 shrink-0 overflow-x-auto">
            {TABS.map(t => {
              const disabled = DISABLED_TABS.has(t)
              const isAtendimento = t === 'Atendimento'
              function handleTabClick() {
                if (disabled) return
                if (isAtendimento && lead.telefone) { handleOpenAtendimento(); return }
                setTab(t)
              }
              return (
                <button
                  key={t}
                  onClick={handleTabClick}
                  disabled={disabled}
                  title={disabled ? 'Em breve' : undefined}
                  className={`text-sm py-2.5 px-3 border-b-2 whitespace-nowrap transition-colors -mb-px flex items-center gap-1.5 ${
                    disabled
                      ? 'border-transparent text-gray-300 cursor-not-allowed'
                      : tab === t
                        ? 'border-blue-500 text-blue-600 font-medium'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {isAtendimento && (
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  )}
                  {t}
                  {t === 'Tarefas' && pendingTasks > 0 && (
                    <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-600 rounded-full px-1.5 py-0.5 font-semibold">{pendingTasks}</span>
                  )}
                  {t === 'Orçamentos' && quotes.length > 0 && (
                    <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-600 rounded-full px-1.5 py-0.5 font-semibold">{quotes.length}</span>
                  )}
                  {t === 'Anotações' && notes.length > 0 && (
                    <span className="ml-1.5 text-[10px] bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5 font-semibold">{notes.length}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Tab body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">

            {/* ═══ HISTÓRICO ═══ */}
            {tab === 'Histórico' && (
              <div className="space-y-4">
                {timeline.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-12">Nenhuma atividade ainda</p>
                )}
                {timeline.map(item => (
                  <div key={`${item.kind}-${item.id}`} className="flex gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      item.kind === 'note'  ? 'bg-blue-100'   :
                      item.kind === 'task'  ? 'bg-emerald-100':
                      item.kind === 'stage' ? 'bg-indigo-100' : 'bg-purple-100'
                    }`}>
                      {item.kind === 'note' && (
                        <svg className="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                      )}
                      {item.kind === 'task' && (
                        <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      )}
                      {item.kind === 'resp' && (
                        <svg className="w-3.5 h-3.5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      )}
                      {item.kind === 'stage' && (
                        <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {item.kind === 'note' && (
                        <>
                          <p className="text-xs text-gray-500 mb-1">{item.note.autor?.full_name ?? '—'} adicionou uma anotação</p>
                          <div className="bg-gray-50 rounded-xl border border-gray-100 px-3 py-2.5">
                            <p className="text-sm text-gray-800 whitespace-pre-wrap">{item.note.conteudo}</p>
                          </div>
                        </>
                      )}
                      {item.kind === 'task' && (
                        <>
                          <p className="text-xs text-gray-500 mb-1">Tarefa concluída</p>
                          <div className="bg-emerald-50 rounded-xl border border-emerald-100 px-3 py-2.5">
                            <p className="text-sm text-gray-500 line-through">{item.task.titulo}</p>
                          </div>
                        </>
                      )}
                      {item.kind === 'resp' && (
                        <div className="bg-purple-50 rounded-xl border border-purple-100 px-3 py-2.5">
                          <p className="text-xs text-gray-600">
                            Responsável alterado →{' '}
                            <span className="font-medium text-purple-700">
                              {profiles.find(p => p.id === item.history.novo_responsavel_id)?.full_name ?? 'Nenhum'}
                            </span>
                          </p>
                        </div>
                      )}
                      {item.kind === 'stage' && (() => {
                        const h       = item.stageHistory
                        const de      = h.de_stage
                        const para    = h.para_stage
                        const quemStr = h.movido_por_profile?.full_name ?? 'Automação'
                        return (
                          <div className="bg-indigo-50 rounded-xl border border-indigo-100 px-3 py-2.5">
                            <p className="text-xs text-gray-500 mb-1.5">{quemStr} moveu o lead</p>
                            <div className="flex items-center gap-2 flex-wrap">
                              {de ? (
                                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600">
                                  {de.nome}
                                </span>
                              ) : (
                                <span className="text-[11px] text-gray-400 italic">entrada</span>
                              )}
                              <svg className="w-3 h-3 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                              </svg>
                              {para && (
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: para.cor || '#6366f1' }}>
                                  {para.nome}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })()}
                      <p className="text-[11px] text-gray-400 mt-1">
                        {format(new Date(item.ts), "d MMM 'às' HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ═══ ANOTAÇÕES ═══ */}
            {tab === 'Anotações' && (
              <div className="space-y-3">
                <div className="flex gap-2 items-start">
                  <textarea
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAddNote() }}
                    placeholder="Nova anotação... (Ctrl+Enter para salvar)"
                    rows={2}
                    className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <button onClick={handleAddNote} disabled={!newNote.trim() || addingNote} className="px-3 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors self-end">
                    {addingNote ? '...' : 'Salvar'}
                  </button>
                </div>

                {notes.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Nenhuma anotação ainda</p>}

                {notes.map(note => {
                  const isEditing  = editingNoteId  === note.id
                  const isDeleting = deletingNoteId === note.id
                  const isOwn      = note.autor_id  === currentUser.id
                  return (
                    <div key={note.id} className={`rounded-xl border p-3 group ${isEditing ? 'border-blue-200 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
                      {isEditing ? (
                        <>
                          <textarea autoFocus value={editNoteText} onChange={e => setEditNoteText(e.target.value)} rows={3} className="w-full bg-white rounded-lg border border-blue-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-2" />
                          <div className="flex gap-2">
                            <button onClick={() => handleSaveNote(note.id)} disabled={!editNoteText.trim()} className="flex-1 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 font-medium">Salvar</button>
                            <button onClick={() => setEditingNoteId(null)} className="flex-1 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-white">Cancelar</button>
                          </div>
                        </>
                      ) : isDeleting ? (
                        <div className="text-xs">
                          <p className="text-red-700 font-medium mb-2">Excluir esta anotação?</p>
                          <div className="flex gap-2">
                            <button onClick={() => handleDeleteNote(note.id)} className="flex-1 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium">Excluir</button>
                            <button onClick={() => setDeletingNoteId(null)} className="flex-1 py-1 border border-gray-200 rounded-lg hover:bg-white">Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.conteudo}</p>
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-xs text-gray-400">
                              {note.autor?.full_name ?? '—'} · {format(new Date(note.created_at), "d MMM 'às' HH:mm", { locale: ptBR })}
                              {note.editado_em && <span className="ml-1 text-gray-300">(editado)</span>}
                            </p>
                            {isOwn && (
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => { setEditingNoteId(note.id); setEditNoteText(note.conteudo) }} className="p-1 text-gray-400 hover:text-blue-500 rounded" title="Editar">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                </button>
                                <button onClick={() => setDeletingNoteId(note.id)} className="p-1 text-gray-400 hover:text-red-500 rounded" title="Excluir">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ═══ TAREFAS ═══ */}
            {tab === 'Tarefas' && (
              <div className="space-y-3">
                <div className="border border-gray-100 rounded-xl p-3 bg-gray-50 space-y-2">
                  <F label="Tarefa *" value={newTask.titulo} onChange={v => setNewTask(t => ({ ...t, titulo: v }))} placeholder="Descreva a tarefa..." />
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Prazo" value={newTask.data_limite} onChange={v => setNewTask(t => ({ ...t, data_limite: v }))} type="datetime-local" />
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Responsável</label>
                      <select value={newTask.responsavel_id} onChange={e => setNewTask(t => ({ ...t, responsavel_id: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                        {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                      </select>
                    </div>
                  </div>
                  <button onClick={handleAddTask} disabled={!newTask.titulo.trim()} className="w-full py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors">
                    Adicionar tarefa
                  </button>
                </div>

                {tasks.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Nenhuma tarefa ainda</p>}

                {tasks.map((task) => {
                  const overdue = !task.concluida && task.data_limite && new Date(task.data_limite) < new Date()
                  return (
                    <div key={task.id} className={`group flex items-start gap-3 p-3 rounded-xl border transition-colors ${task.concluida ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-200'}`}>
                      <button onClick={() => handleToggleTask(task)} className="mt-0.5 shrink-0">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${task.concluida ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 hover:border-blue-400'}`}>
                          {task.concluida && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                        </div>
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${task.concluida ? 'line-through text-gray-400' : 'text-gray-800'}`}>{task.titulo}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5">
                          {task.data_limite && (
                            <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                              {overdue ? '⚠ ' : ''}{format(new Date(task.data_limite), "d MMM 'às' HH:mm", { locale: ptBR })}
                            </span>
                          )}
                          {task.responsavel && <span className="text-xs text-gray-400">{task.responsavel.full_name}</span>}
                        </div>
                      </div>
                      {deletingTaskId === task.id ? (
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => handleDeleteTask(task.id)} className="text-[11px] px-2 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600">Excluir</button>
                          <button onClick={() => setDeletingTaskId(null)} className="text-[11px] px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50">Não</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeletingTaskId(task.id)} className="shrink-0 p-1 text-gray-300 hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-all">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      )}
                    </div>
                  )
                })}
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
                    href={clientId ? `/orcamento?client_id=${clientId}` : `/orcamento?lead_id=${lead.id}`}
                    className="flex items-center justify-center gap-1.5 w-full py-2.5 text-sm font-medium text-white bg-blue-500 rounded-xl hover:bg-blue-600 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
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
                    <div key={q.id} className="border border-gray-200 rounded-xl p-3.5 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono font-semibold text-gray-500">
                            #{String(q.numero ?? 0).padStart(4, '0')}
                          </span>
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${QUOTE_STATUS_COLORS[q.status]}`}>
                            {QUOTE_STATUS_LABELS[q.status]}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-gray-900">
                            {q.total_calculado != null ? fmtBRL.format(q.total_calculado) : '—'}
                          </span>
                          <span className="text-xs text-gray-400">
                            {new Date(q.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Copiar link */}
                        <button
                          onClick={() => handleCopyLink(q)}
                          title={copiedQuoteId === q.id ? 'Copiado!' : 'Copiar link do paciente'}
                          className={`p-1.5 rounded-lg transition-colors ${copiedQuoteId === q.id ? 'text-emerald-600 bg-emerald-50' : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                        >
                          {copiedQuoteId === q.id ? (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                        {/* Editar */}
                        <a
                          href={`/orcamento?quote_id=${q.id}`}
                          title="Editar orçamento"
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* ═══ ATENDIMENTO (no-phone fallback) ═══ */}
            {tab === 'Atendimento' && !lead.telefone && (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Telefone não cadastrado</p>
                  <p className="text-xs text-gray-400 mt-1">Cadastre um telefone para acessar o atendimento</p>
                </div>
                <button
                  onClick={() => { setTab('Histórico'); setEditing(true) }}
                  className="text-sm px-4 py-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors font-medium"
                >
                  Editar dados
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Archive modal ── */}
      {archiveModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-0.5">Arquivar lead</h3>
            <p className="text-xs text-gray-500 mb-4">O lead será removido do funil e preservado no banco.</p>
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

function LeftSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-gray-400 shrink-0 w-20 text-right leading-5">{label}</span>
      <div className="flex-1 min-w-0 text-gray-800 leading-5 flex items-center gap-1 flex-wrap">{children}</div>
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
