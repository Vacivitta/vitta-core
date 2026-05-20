'use client'

import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type {
  Lead, LeadKanban, FunnelWithStages,
  LeadContact, LeadNote, LeadTask, Profile, ContactRole,
} from '@/types/database'
import {
  CONTACT_ROLE_LABELS, ARCHIVE_REASONS, ORIGEM_OPTIONS,
  type ArchiveReason,
} from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { updateLead, createLead, archiveLead, restoreLead } from '@/lib/leads'

interface Props {
  lead: LeadKanban | null          // null = novo lead
  defaultStageId: string
  funnel: FunnelWithStages
  allFunnels: FunnelWithStages[]
  profiles: Profile[]
  currentUser: Profile
  onClose: () => void
  onSaved: () => void
}

// Normaliza texto para comparação sem acentos
const norm = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export default function LeadModal({
  lead, defaultStageId, funnel, allFunnels, profiles, currentUser, onClose, onSaved,
}: Props) {
  const isNew      = !lead
  const isArchived = lead?.arquivado === true
  const supabase   = createClient()

  // ---- Dados básicos --------------------------------------------------------
  const [form, setForm] = useState({
    nome:           lead?.nome           ?? '',
    sobrenome:      lead?.sobrenome      ?? '',
    profissao:      lead?.profissao      ?? '',
    cidade:         lead?.cidade         ?? '',
    estado:         lead?.estado         ?? '',
    pais:           lead?.pais           ?? 'Brasil',
    instagram:      lead?.instagram      ?? '',
    site:           lead?.site           ?? '',
    email:          lead?.email          ?? '',
    telefone:       lead?.telefone       ?? '',
    origem:         lead?.origem         ?? '',
    funnel_id:      lead?.funnel_id      ?? funnel.id,
    stage_id:       lead?.stage_id       ?? defaultStageId,
    responsavel_id: lead?.responsavel_id ?? currentUser.id,
  })

  const activeFunnel = allFunnels.find(f => f.id === form.funnel_id) ?? funnel
  const activeStages = activeFunnel.stages

  function handleFunnelChange(funnelId: string) {
    const f = allFunnels.find(x => x.id === funnelId)
    setForm(prev => ({
      ...prev,
      funnel_id: funnelId,
      stage_id:  f?.stages[0]?.id ?? prev.stage_id,
    }))
  }

  // Aba de negociação visível quando a etapa atual contém "negociação"
  // ou quando o lead já tem dados de negociação (evita esconder dados existentes)
  const currentStage = activeStages.find(s => s.id === form.stage_id)
  const [negotiation, setNegotiation] = useState({
    valor_proposta:  lead?.valor_proposta?.toString()  ?? '',
    modelo:          lead?.modelo                      ?? '',
    valor_negociado: lead?.valor_negociado?.toString() ?? '',
  })
  const showNegotiation =
    norm(currentStage?.nome ?? '').includes('negociacao') ||
    !!(lead?.valor_proposta || lead?.valor_negociado || lead?.modelo) ||
    !!(negotiation.valor_proposta || negotiation.modelo || negotiation.valor_negociado)

  const TABS = [
    'Dados', 'Contatos', 'Anotações', 'Tarefas',
    ...(showNegotiation ? ['Negociação'] : []),
  ] as const
  type Tab = typeof TABS[number]

  const [tab,    setTab]    = useState<Tab>('Dados')
  const [saving, setSaving] = useState(false)

  // ---- Contatos -------------------------------------------------------------
  const [savedContacts,      setSavedContacts]      = useState<LeadContact[]>([])
  const [newContacts,        setNewContacts]         = useState<Omit<LeadContact, 'id' | 'lead_id' | 'created_at'>[]>([])
  const [editingContactId,   setEditingContactId]   = useState<string | null>(null)
  const [editContactDraft,   setEditContactDraft]   = useState<Partial<LeadContact>>({})
  const [deletingContactId,  setDeletingContactId]  = useState<string | null>(null)

  // ---- Anotações ------------------------------------------------------------
  const [notes,          setNotes]          = useState<LeadNote[]>([])
  const [newNote,        setNewNote]        = useState('')
  const [addingNote,     setAddingNote]     = useState(false)
  const [editingNoteId,  setEditingNoteId]  = useState<string | null>(null)
  const [editNoteText,   setEditNoteText]   = useState('')
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null)

  // ---- Tarefas --------------------------------------------------------------
  const [tasks,   setTasks]   = useState<LeadTask[]>([])
  const [newTask, setNewTask] = useState({
    titulo:         '',
    data_limite:    '',
    responsavel_id: currentUser.id,
  })
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null)

  // ---- Arquivamento ---------------------------------------------------------
  const [archiveModal,     setArchiveModal]     = useState(false)
  const [archiveReason,    setArchiveReason]    = useState<ArchiveReason | ''>('')
  const [archiveCustom,    setArchiveCustom]    = useState('')
  const [archiveSaving,    setArchiveSaving]    = useState(false)

  // ---- Carrega dados do lead existente -------------------------------------
  useEffect(() => {
    if (!lead) return
    const id = lead.id

    supabase
      .from('lead_contacts')
      .select('*')
      .eq('lead_id', id)
      .order('created_at')
      .then(({ data }) => { if (data) setSavedContacts(data as LeadContact[]) })

    supabase
      .from('lead_notes')
      .select('*, autor:profiles(*)')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setNotes(data as LeadNote[]) })

    supabase
      .from('lead_tasks')
      .select('*, responsavel:profiles(*)')
      .eq('lead_id', id)
      .order('concluida')
      .order('data_limite', { nullsFirst: false })
      .then(({ data }) => { if (data) setTasks(data as LeadTask[]) })

    supabase
      .from('lead_negotiation')
      .select('*')
      .eq('lead_id', id)
      .single()
      .then(({ data }) => {
        if (data) setNegotiation({
          valor_proposta:  data.valor_proposta?.toString()  ?? '',
          modelo:          data.modelo                      ?? '',
          valor_negociado: data.valor_negociado?.toString() ?? '',
        })
      })
  }, [lead]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Save ----------------------------------------------------------------
  async function handleSave() {
    if (!form.nome.trim()) return
    setSaving(true)
    try {
      let leadId = lead?.id
      const payload = { ...form, responsavel_id: form.responsavel_id || null }

      if (isNew) {
        const created = await createLead(payload)
        leadId = created.id
      } else {
        await updateLead(lead.id, payload)
      }

      // Salva contatos novos
      const validNew = newContacts.filter(c => c.nome.trim())
      if (validNew.length > 0 && leadId) {
        await supabase.from('lead_contacts').insert(
          validNew.map(c => ({ ...c, lead_id: leadId }))
        )
      }

      // Salva edição de contato pendente
      if (editingContactId && leadId) {
        await supabase.from('lead_contacts').update(editContactDraft).eq('id', editingContactId)
      }

      // Salva negociação
      if (leadId && (negotiation.valor_proposta || negotiation.modelo || negotiation.valor_negociado)) {
        await supabase.from('lead_negotiation').upsert({
          lead_id:        leadId,
          valor_proposta:  negotiation.valor_proposta  ? parseFloat(negotiation.valor_proposta)  : null,
          modelo:          negotiation.modelo          || null,
          valor_negociado: negotiation.valor_negociado ? parseFloat(negotiation.valor_negociado) : null,
        }, { onConflict: 'lead_id' })
      }

      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  // ---- Contatos actions ----------------------------------------------------
  function addNewContact() {
    setNewContacts(prev => [...prev, { nome: '', telefone: '', email: '', cargo: 'outro', observacao: '' }])
  }

  function updateNewContact(i: number, field: string, value: string) {
    setNewContacts(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }

  function removeNewContact(i: number) {
    setNewContacts(prev => prev.filter((_, idx) => idx !== i))
  }

  function startEditContact(c: LeadContact) {
    setEditingContactId(c.id)
    setEditContactDraft({ nome: c.nome, telefone: c.telefone, email: c.email, cargo: c.cargo, observacao: c.observacao })
  }

  async function saveContactEdit() {
    if (!editingContactId) return
    await supabase.from('lead_contacts').update(editContactDraft).eq('id', editingContactId)
    setSavedContacts(prev => prev.map(c => c.id === editingContactId ? { ...c, ...editContactDraft } : c))
    setEditingContactId(null)
    setEditContactDraft({})
  }

  async function deleteContact(id: string) {
    await supabase.from('lead_contacts').delete().eq('id', id)
    setSavedContacts(prev => prev.filter(c => c.id !== id))
    setDeletingContactId(null)
  }

  // ---- Anotações actions ---------------------------------------------------
  async function handleAddNote() {
    if (!newNote.trim() || !lead) return
    setAddingNote(true)
    try {
      const { data } = await supabase
        .from('lead_notes')
        .insert({ lead_id: lead.id, conteudo: newNote.trim(), autor_id: currentUser.id })
        .select('*, autor:profiles(*)')
        .single()
      if (data) { setNotes(prev => [data as LeadNote, ...prev]); setNewNote('') }
    } finally { setAddingNote(false) }
  }

  async function handleSaveNote(id: string) {
    if (!editNoteText.trim()) return
    const { data } = await supabase
      .from('lead_notes')
      .update({ conteudo: editNoteText.trim(), editado_em: new Date().toISOString() })
      .eq('id', id)
      .select('*, autor:profiles(*)')
      .single()
    if (data) setNotes(prev => prev.map(n => n.id === id ? data as LeadNote : n))
    setEditingNoteId(null)
  }

  async function handleDeleteNote(id: string) {
    await supabase.from('lead_notes').delete().eq('id', id)
    setNotes(prev => prev.filter(n => n.id !== id))
    setDeletingNoteId(null)
  }

  // ---- Tarefas actions -----------------------------------------------------
  async function handleAddTask() {
    if (!newTask.titulo.trim() || !lead) return
    const { data } = await supabase
      .from('lead_tasks')
      .insert({
        lead_id:        lead.id,
        titulo:         newTask.titulo.trim(),
        responsavel_id: newTask.responsavel_id || currentUser.id,
        data_limite:    newTask.data_limite || null,
      })
      .select('*, responsavel:profiles(*)')
      .single()
    if (data) {
      setTasks(prev => [data as LeadTask, ...prev])
      setNewTask({ titulo: '', data_limite: '', responsavel_id: currentUser.id })
    }
  }

  async function handleToggleTask(task: LeadTask) {
    const { data } = await supabase
      .from('lead_tasks')
      .update({ concluida: !task.concluida })
      .eq('id', task.id)
      .select('*, responsavel:profiles(*)')
      .single()
    if (data) setTasks(prev => prev.map(t => t.id === task.id ? data as LeadTask : t))
  }

  async function handleDeleteTask(id: string) {
    await supabase.from('lead_tasks').delete().eq('id', id)
    setTasks(prev => prev.filter(t => t.id !== id))
    setDeletingTaskId(null)
  }

  // ---- Restaurar -----------------------------------------------------------
  async function handleRestore() {
    if (!lead) return
    await restoreLead(lead.id)
    onSaved()
    onClose()
  }

  // ---- Arquivamento --------------------------------------------------------
  async function handleArchive() {
    if (!archiveReason || !lead) return
    const motivo = archiveReason === 'Outro'
      ? `Outro: ${archiveCustom.trim() || '—'}`
      : archiveReason
    setArchiveSaving(true)
    try {
      await archiveLead(lead.id, motivo)
      onSaved()
      onClose()
    } finally { setArchiveSaving(false) }
  }

  // --------------------------------------------------------------------------

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl h-[95dvh] sm:h-auto sm:max-h-[92vh] flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 leading-tight">
              {isNew ? 'Novo Lead' : `${lead.nome}${lead.sobrenome ? ` ${lead.sobrenome}` : ''}`}
            </h2>
            {!isNew && lead.stage_nome && (
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded-full mt-0.5 inline-block"
                style={{ backgroundColor: `${lead.stage_cor}22`, color: lead.stage_cor ?? '#64748b' }}
              >
                {lead.stage_nome}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isNew && !isArchived && (
              <button
                onClick={() => setArchiveModal(true)}
                className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors"
              >
                Arquivar
              </button>
            )}
            {isArchived && (
              <button
                onClick={handleRestore}
                className="text-xs text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 px-2.5 py-1 rounded-lg transition-colors font-medium"
              >
                Restaurar
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1.5 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b border-gray-100 px-4 gap-0.5 shrink-0 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t as Tab)}
              className={`text-sm py-2.5 px-3 border-b-2 whitespace-nowrap transition-colors -mb-px ${
                tab === t
                  ? 'border-blue-500 text-blue-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
              {t === 'Tarefas'   && tasks.filter(t => !t.concluida).length > 0  && (
                <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-600 rounded-full px-1.5 py-0.5 font-semibold">
                  {tasks.filter(t => !t.concluida).length}
                </span>
              )}
              {t === 'Anotações' && notes.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5 font-semibold">
                  {notes.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* ═══ DADOS ═══ */}
          {tab === 'Dados' && (
            <div className="grid grid-cols-2 gap-3">
              <F label="Nome *"    value={form.nome}      onChange={v => setForm(f => ({ ...f, nome: v }))} autoFocus={isNew} />
              <F label="Sobrenome" value={form.sobrenome} onChange={v => setForm(f => ({ ...f, sobrenome: v }))} />
              <F label="Profissão" value={form.profissao} onChange={v => setForm(f => ({ ...f, profissao: v }))} />
              <F label="Telefone"  value={form.telefone}  onChange={v => setForm(f => ({ ...f, telefone: v }))} />
              <F label="E-mail"    value={form.email}     onChange={v => setForm(f => ({ ...f, email: v }))}    type="email" />
              <F label="Instagram" value={form.instagram} onChange={v => setForm(f => ({ ...f, instagram: v }))} placeholder="@usuario" />
              <F label="Site"      value={form.site}      onChange={v => setForm(f => ({ ...f, site: v }))}      placeholder="https://" />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Origem</label>
                <select
                  value={form.origem}
                  onChange={e => setForm(f => ({ ...f, origem: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Selecionar...</option>
                  {ORIGEM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <F label="Cidade" value={form.cidade} onChange={v => setForm(f => ({ ...f, cidade: v }))} />
              <F label="Estado" value={form.estado} onChange={v => setForm(f => ({ ...f, estado: v }))} />
              <F label="País"   value={form.pais}   onChange={v => setForm(f => ({ ...f, pais: v }))} />

              <div className="col-span-2 grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Funil</label>
                  <select
                    value={form.funnel_id}
                    onChange={e => handleFunnelChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {allFunnels.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Etapa</label>
                  <select
                    value={form.stage_id}
                    onChange={e => setForm(f => ({ ...f, stage_id: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {activeStages.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Responsável</label>
                  <select
                    value={form.responsavel_id}
                    onChange={e => setForm(f => ({ ...f, responsavel_id: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Sem responsável</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ═══ CONTATOS ═══ */}
          {tab === 'Contatos' && (
            <div className="space-y-3">
              {/* Contatos salvos */}
              {savedContacts.map(c => (
                <div key={c.id} className="border border-gray-200 rounded-xl overflow-hidden">
                  {editingContactId === c.id ? (
                    /* Modo edição */
                    <div className="p-3 bg-blue-50 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <F label="Nome *" value={editContactDraft.nome ?? ''} onChange={v => setEditContactDraft(d => ({ ...d, nome: v }))} />
                        <F label="Telefone" value={editContactDraft.telefone ?? ''} onChange={v => setEditContactDraft(d => ({ ...d, telefone: v }))} />
                        <F label="E-mail" value={editContactDraft.email ?? ''} onChange={v => setEditContactDraft(d => ({ ...d, email: v }))} type="email" />
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Cargo</label>
                          <select
                            value={editContactDraft.cargo ?? 'outro'}
                            onChange={e => setEditContactDraft(d => ({ ...d, cargo: e.target.value as ContactRole }))}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          >
                            {Object.entries(CONTACT_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </div>
                      </div>
                      <F label="Observação" value={editContactDraft.observacao ?? ''} onChange={v => setEditContactDraft(d => ({ ...d, observacao: v }))} />
                      <div className="flex gap-2 pt-1">
                        <button onClick={saveContactEdit} className="flex-1 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium">Salvar</button>
                        <button onClick={() => { setEditingContactId(null); setEditContactDraft({}) }} className="flex-1 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
                      </div>
                    </div>
                  ) : deletingContactId === c.id ? (
                    /* Confirmação de exclusão */
                    <div className="p-3 bg-red-50 text-xs">
                      <p className="text-red-700 font-medium mb-1">Excluir contato "{c.nome}"?</p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => deleteContact(c.id)} className="flex-1 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium">Excluir</button>
                        <button onClick={() => setDeletingContactId(null)} className="flex-1 py-1 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    /* Visualização */
                    <div className="p-3 group">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-gray-900">{c.nome}</span>
                            <span className="text-[11px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                              {CONTACT_ROLE_LABELS[c.cargo]}
                            </span>
                          </div>
                          <div className="mt-1 space-y-0.5">
                            {c.telefone && <p className="text-xs text-gray-500">{c.telefone}</p>}
                            {c.email    && <p className="text-xs text-blue-500">{c.email}</p>}
                            {c.observacao && <p className="text-xs text-gray-400 italic">{c.observacao}</p>}
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button onClick={() => startEditContact(c)} className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors" title="Editar">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button onClick={() => setDeletingContactId(c.id)} className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors" title="Excluir">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Formulários para novos contatos */}
              {newContacts.map((c, i) => (
                <div key={i} className="border border-blue-200 rounded-xl p-3 bg-blue-50 space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-blue-700">Novo contato</span>
                    <button onClick={() => removeNewContact(i)} className="text-gray-400 hover:text-red-500 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Nome *"   value={c.nome}          onChange={v => updateNewContact(i, 'nome', v)} />
                    <F label="Telefone" value={c.telefone ?? ''} onChange={v => updateNewContact(i, 'telefone', v)} />
                    <F label="E-mail"   value={c.email ?? ''}   onChange={v => updateNewContact(i, 'email', v)}   type="email" />
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Cargo</label>
                      <select
                        value={c.cargo}
                        onChange={e => updateNewContact(i, 'cargo', e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        {Object.entries(CONTACT_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <F label="Observação" value={c.observacao ?? ''} onChange={v => updateNewContact(i, 'observacao', v)} />
                </div>
              ))}

              <button
                onClick={addNewContact}
                className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
              >
                + Adicionar contato
              </button>
            </div>
          )}

          {/* ═══ ANOTAÇÕES ═══ */}
          {tab === 'Anotações' && (
            <div className="space-y-3">
              {!isNew && (
                <div className="flex gap-2 items-start">
                  <textarea
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAddNote() }}
                    placeholder="Nova anotação... (Ctrl+Enter para salvar)"
                    rows={2}
                    className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <button
                    onClick={handleAddNote}
                    disabled={!newNote.trim() || addingNote}
                    className="px-3 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors self-end"
                  >
                    {addingNote ? '...' : 'Salvar'}
                  </button>
                </div>
              )}

              {notes.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">Nenhuma anotação ainda</p>
              )}

              {notes.map(note => {
                const isOwn    = note.autor_id === currentUser.id
                const isEditing = editingNoteId === note.id
                const isDeleting = deletingNoteId === note.id

                return (
                  <div
                    key={note.id}
                    className={`rounded-xl border p-3 group ${isEditing ? 'border-blue-200 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}
                  >
                    {isEditing ? (
                      <>
                        <textarea
                          autoFocus
                          value={editNoteText}
                          onChange={e => setEditNoteText(e.target.value)}
                          rows={3}
                          className="w-full bg-white rounded-lg border border-blue-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-2"
                        />
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
                              <button
                                onClick={() => { setEditingNoteId(note.id); setEditNoteText(note.conteudo) }}
                                className="p-1 text-gray-400 hover:text-blue-500 rounded transition-colors"
                                title="Editar"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setDeletingNoteId(note.id)}
                                className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                                title="Excluir"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
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
              {!isNew && (
                <div className="border border-gray-100 rounded-xl p-3 bg-gray-50 space-y-2">
                  <F label="Tarefa *" value={newTask.titulo} onChange={v => setNewTask(t => ({ ...t, titulo: v }))} placeholder="Descreva a tarefa..." />
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Prazo" value={newTask.data_limite} onChange={v => setNewTask(t => ({ ...t, data_limite: v }))} type="datetime-local" />
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Responsável</label>
                      <select
                        value={newTask.responsavel_id}
                        onChange={e => setNewTask(t => ({ ...t, responsavel_id: e.target.value }))}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={handleAddTask}
                    disabled={!newTask.titulo.trim()}
                    className="w-full py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors"
                  >
                    Adicionar tarefa
                  </button>
                </div>
              )}

              {tasks.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">Nenhuma tarefa ainda</p>
              )}

              {tasks.map(task => {
                const overdue = !task.concluida && task.data_limite && new Date(task.data_limite) < new Date()
                return (
                  <div
                    key={task.id}
                    className={`group flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                      task.concluida ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-200'
                    }`}
                  >
                    <button onClick={() => handleToggleTask(task)} className="mt-0.5 shrink-0">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                        task.concluida ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 hover:border-blue-400'
                      }`}>
                        {task.concluida && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${task.concluida ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                        {task.titulo}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        {task.data_limite && (
                          <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                            {overdue && '⚠ '}{format(new Date(task.data_limite), "d MMM 'às' HH:mm", { locale: ptBR })}
                          </span>
                        )}
                        {task.responsavel && (
                          <span className="text-xs text-gray-400">{task.responsavel.full_name}</span>
                        )}
                      </div>
                    </div>

                    {deletingTaskId === task.id ? (
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => handleDeleteTask(task.id)} className="text-[11px] px-2 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600">Excluir</button>
                        <button onClick={() => setDeletingTaskId(null)} className="text-[11px] px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50">Não</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeletingTaskId(task.id)}
                        className="shrink-0 p-1 text-gray-300 hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* ═══ NEGOCIAÇÃO ═══ */}
          {tab === 'Negociação' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-xl">
                <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-amber-700">
                  Preencha quando o lead estiver em negociação ativa.
                </p>
              </div>
              <F
                label="Modelo / Serviço"
                value={negotiation.modelo}
                onChange={v => setNegotiation(n => ({ ...n, modelo: v }))}
                placeholder="Ex: Plano Anual, Consultoria Premium..."
              />
              <div className="grid grid-cols-2 gap-3">
                <F label="Valor da Proposta (R$)"  value={negotiation.valor_proposta}  onChange={v => setNegotiation(n => ({ ...n, valor_proposta: v }))}  type="number" placeholder="0,00" />
                <F label="Valor Negociado (R$)"    value={negotiation.valor_negociado} onChange={v => setNegotiation(n => ({ ...n, valor_negociado: v }))} type="number" placeholder="0,00" />
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.nome.trim()}
            className="px-5 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Salvando...' : isNew ? 'Criar Lead' : 'Salvar alterações'}
          </button>
        </div>
      </div>

      {/* ── Modal arquivamento ── */}
      {archiveModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-0.5">Arquivar lead</h3>
            <p className="text-xs text-gray-500 mb-4">
              O lead será removido do funil e preservado no banco. Esta ação não pode ser desfeita.
            </p>

            <p className="text-xs font-medium text-gray-700 mb-2">Motivo da perda *</p>
            <div className="space-y-2 mb-3">
              {ARCHIVE_REASONS.map(reason => (
                <label key={reason} className="flex items-center gap-2.5 cursor-pointer group">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                    archiveReason === reason ? 'border-red-500 bg-red-500' : 'border-gray-300 group-hover:border-red-400'
                  }`}>
                    {archiveReason === reason && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <input
                    type="radio"
                    name="archive-reason"
                    value={reason}
                    checked={archiveReason === reason}
                    onChange={() => setArchiveReason(reason)}
                    className="sr-only"
                  />
                  <span className="text-sm text-gray-700">{reason}</span>
                </label>
              ))}
            </div>

            {archiveReason === 'Outro' && (
              <textarea
                autoFocus
                value={archiveCustom}
                onChange={e => setArchiveCustom(e.target.value)}
                placeholder="Descreva o motivo..."
                rows={2}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none mb-3"
              />
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setArchiveModal(false); setArchiveReason(''); setArchiveCustom('') }}
                className="flex-1 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
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
    </div>
  )
}

// ── Input helper ─────────────────────────────────────────────────────────────
function F({
  label, value, onChange, type = 'text', placeholder, autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  autoFocus?: boolean
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
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300"
      />
    </div>
  )
}
