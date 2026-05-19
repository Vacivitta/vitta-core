'use client'

import { useState, useEffect, useRef } from 'react'
import type { Lead, LeadKanban, LeadStage, LeadContact, LeadNote, LeadTask, Profile, ContactRole } from '@/types/database'
import { STAGE_LABELS, STAGE_ORDER, CONTACT_ROLE_LABELS } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { updateLead, createLead, archiveLead } from '@/lib/leads'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface Props {
  lead: LeadKanban | null
  defaultStage?: LeadStage
  profiles: Profile[]
  currentUser: Profile
  onClose: () => void
  onSaved: () => void
}

const TABS = ['Dados', 'Contatos', 'Anotações', 'Tarefas', 'Negociação'] as const
type Tab = typeof TABS[number]

export default function LeadModal({ lead, defaultStage = 'lead', profiles, currentUser, onClose, onSaved }: Props) {
  const isNew = !lead
  const supabase = createClient()

  const [tab, setTab] = useState<Tab>('Dados')
  const [saving, setSaving] = useState(false)
  const [archiveModal, setArchiveModal] = useState(false)
  const [archiveReason, setArchiveReason] = useState('')

  // Dados básicos
  const [form, setForm] = useState({
    nome: lead?.nome ?? '',
    sobrenome: lead?.sobrenome ?? '',
    profissao: lead?.profissao ?? '',
    cidade: lead?.cidade ?? '',
    estado: lead?.estado ?? '',
    pais: lead?.pais ?? 'Brasil',
    instagram: lead?.instagram ?? '',
    site: lead?.site ?? '',
    email: lead?.email ?? '',
    telefone: lead?.telefone ?? '',
    stage: lead?.stage ?? defaultStage,
    responsavel_id: lead?.responsavel_id ?? currentUser.id,
  })

  // Contatos
  const [contacts, setContacts] = useState<Omit<LeadContact, 'id' | 'lead_id' | 'created_at'>[]>([])
  const [savedContacts, setSavedContacts] = useState<LeadContact[]>([])

  // Anotações
  const [notes, setNotes] = useState<LeadNote[]>([])
  const [newNote, setNewNote] = useState('')

  // Tarefas
  const [tasks, setTasks] = useState<LeadTask[]>([])
  const [newTask, setNewTask] = useState({ titulo: '', data_limite: '', responsavel_id: currentUser.id })

  // Negociação
  const [negotiation, setNegotiation] = useState({
    valor_proposta: lead?.valor_proposta?.toString() ?? '',
    modelo: lead?.modelo ?? '',
    valor_negociado: lead?.valor_negociado?.toString() ?? '',
  })

  useEffect(() => {
    if (!lead) return
    const id = lead.id

    supabase.from('lead_contacts').select('*').eq('lead_id', id).then(({ data }) => {
      if (data) setSavedContacts(data)
    })
    supabase.from('lead_notes').select('*, autor:profiles(*)').eq('lead_id', id).order('created_at', { ascending: false }).then(({ data }) => {
      if (data) setNotes(data as LeadNote[])
    })
    supabase.from('lead_tasks').select('*, responsavel:profiles(*)').eq('lead_id', id).order('data_limite').then(({ data }) => {
      if (data) setTasks(data as LeadTask[])
    })
    supabase.from('lead_negotiation').select('*').eq('lead_id', id).single().then(({ data }) => {
      if (data) setNegotiation({
        valor_proposta: data.valor_proposta?.toString() ?? '',
        modelo: data.modelo ?? '',
        valor_negociado: data.valor_negociado?.toString() ?? '',
      })
    })
  }, [lead])

  async function handleSave() {
    if (!form.nome.trim()) return
    setSaving(true)
    try {
      let leadId = lead?.id

      if (isNew) {
        const created = await createLead({ ...form, responsavel_id: form.responsavel_id || null })
        leadId = created.id
      } else {
        await updateLead(lead.id, { ...form, responsavel_id: form.responsavel_id || null })
      }

      // Salva contatos novos
      if (contacts.length > 0 && leadId) {
        await supabase.from('lead_contacts').insert(contacts.map(c => ({ ...c, lead_id: leadId })))
      }

      // Salva negociação
      if (leadId && (negotiation.valor_proposta || negotiation.modelo || negotiation.valor_negociado)) {
        await supabase.from('lead_negotiation').upsert({
          lead_id: leadId,
          valor_proposta: negotiation.valor_proposta ? parseFloat(negotiation.valor_proposta) : null,
          modelo: negotiation.modelo || null,
          valor_negociado: negotiation.valor_negociado ? parseFloat(negotiation.valor_negociado) : null,
        }, { onConflict: 'lead_id' })
      }

      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function handleAddNote() {
    if (!newNote.trim() || !lead) return
    const { data } = await supabase.from('lead_notes').insert({
      lead_id: lead.id,
      conteudo: newNote.trim(),
      autor_id: currentUser.id,
    }).select('*, autor:profiles(*)').single()
    if (data) {
      setNotes(prev => [data as LeadNote, ...prev])
      setNewNote('')
    }
  }

  async function handleAddTask() {
    if (!newTask.titulo.trim() || !lead) return
    const { data } = await supabase.from('lead_tasks').insert({
      lead_id: lead.id,
      titulo: newTask.titulo.trim(),
      responsavel_id: newTask.responsavel_id || currentUser.id,
      data_limite: newTask.data_limite || null,
    }).select('*, responsavel:profiles(*)').single()
    if (data) {
      setTasks(prev => [...prev, data as LeadTask])
      setNewTask({ titulo: '', data_limite: '', responsavel_id: currentUser.id })
    }
  }

  async function handleToggleTask(task: LeadTask) {
    await supabase.from('lead_tasks').update({ concluida: !task.concluida }).eq('id', task.id)
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, concluida: !t.concluida } : t))
  }

  async function handleArchive() {
    if (!archiveReason.trim() || !lead) return
    await archiveLead(lead.id, archiveReason.trim())
    onSaved()
    onClose()
  }

  function addContact() {
    setContacts(prev => [...prev, { nome: '', telefone: '', cargo: 'outro', observacao: '' }])
  }

  function updateContact(i: number, field: string, value: string) {
    setContacts(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {isNew ? 'Novo Lead' : `${lead.nome} ${lead.sobrenome ?? ''}`}
          </h2>
          <div className="flex items-center gap-2">
            {!isNew && (
              <button
                onClick={() => setArchiveModal(true)}
                className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors"
              >
                Arquivar
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1.5 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5 gap-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-sm py-2.5 px-3 border-b-2 transition-colors -mb-px ${
                tab === t
                  ? 'border-blue-500 text-blue-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'Dados' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome *" value={form.nome} onChange={v => setForm(f => ({ ...f, nome: v }))} />
              <Field label="Sobrenome" value={form.sobrenome} onChange={v => setForm(f => ({ ...f, sobrenome: v }))} />
              <Field label="Profissão" value={form.profissao} onChange={v => setForm(f => ({ ...f, profissao: v }))} />
              <Field label="Telefone" value={form.telefone} onChange={v => setForm(f => ({ ...f, telefone: v }))} />
              <Field label="E-mail" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} type="email" />
              <Field label="Instagram" value={form.instagram} onChange={v => setForm(f => ({ ...f, instagram: v }))} placeholder="@usuario" />
              <Field label="Site" value={form.site} onChange={v => setForm(f => ({ ...f, site: v }))} placeholder="https://" />
              <Field label="Cidade" value={form.cidade} onChange={v => setForm(f => ({ ...f, cidade: v }))} />
              <Field label="Estado" value={form.estado} onChange={v => setForm(f => ({ ...f, estado: v }))} />
              <Field label="País" value={form.pais} onChange={v => setForm(f => ({ ...f, pais: v }))} />

              <div className="col-span-2 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Etapa</label>
                  <select
                    value={form.stage}
                    onChange={e => setForm(f => ({ ...f, stage: e.target.value as LeadStage }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {STAGE_ORDER.map(s => (
                      <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Responsável</label>
                  <select
                    value={form.responsavel_id}
                    onChange={e => setForm(f => ({ ...f, responsavel_id: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.full_name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {tab === 'Contatos' && (
            <div className="space-y-4">
              {/* Contatos salvos */}
              {savedContacts.map(c => (
                <div key={c.id} className="border border-gray-100 rounded-xl p-3 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm text-gray-900">{c.nome}</span>
                    <span className="text-xs bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-600">
                      {CONTACT_ROLE_LABELS[c.cargo]}
                    </span>
                  </div>
                  {c.telefone && <p className="text-xs text-gray-500 mt-1">{c.telefone}</p>}
                  {c.observacao && <p className="text-xs text-gray-400 mt-1 italic">{c.observacao}</p>}
                </div>
              ))}

              {/* Novos contatos */}
              {contacts.map((c, i) => (
                <div key={i} className="border border-blue-100 rounded-xl p-3 bg-blue-50 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Nome *" value={c.nome} onChange={v => updateContact(i, 'nome', v)} />
                    <Field label="Telefone" value={c.telefone ?? ''} onChange={v => updateContact(i, 'telefone', v)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Cargo</label>
                      <select
                        value={c.cargo}
                        onChange={e => updateContact(i, 'cargo', e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        {Object.entries(CONTACT_ROLE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                    <Field label="Observação" value={c.observacao ?? ''} onChange={v => updateContact(i, 'observacao', v)} />
                  </div>
                </div>
              ))}

              <button
                onClick={addContact}
                className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-500 hover:border-blue-300 hover:text-blue-500 transition-colors"
              >
                + Adicionar contato
              </button>
            </div>
          )}

          {tab === 'Anotações' && (
            <div className="space-y-3">
              {!isNew && (
                <div className="flex gap-2">
                  <textarea
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    placeholder="Nova anotação..."
                    rows={2}
                    className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <button
                    onClick={handleAddNote}
                    disabled={!newNote.trim()}
                    className="px-3 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors self-end"
                  >
                    Salvar
                  </button>
                </div>
              )}
              {notes.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-6">Nenhuma anotação ainda</p>
              )}
              {notes.map(note => (
                <div key={note.id} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.conteudo}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    {note.autor?.full_name ?? 'Desconhecido'} · {format(new Date(note.created_at), "d MMM yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
              ))}
            </div>
          )}

          {tab === 'Tarefas' && (
            <div className="space-y-3">
              {!isNew && (
                <div className="border border-gray-100 rounded-xl p-3 bg-gray-50 space-y-2">
                  <Field label="Tarefa *" value={newTask.titulo} onChange={v => setNewTask(t => ({ ...t, titulo: v }))} placeholder="Descreva a tarefa..." />
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Prazo" value={newTask.data_limite} onChange={v => setNewTask(t => ({ ...t, data_limite: v }))} type="datetime-local" />
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
                <p className="text-sm text-gray-400 text-center py-6">Nenhuma tarefa ainda</p>
              )}
              {tasks.map(task => (
                <div
                  key={task.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                    task.concluida ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-200'
                  }`}
                >
                  <button onClick={() => handleToggleTask(task)} className="mt-0.5 shrink-0">
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                      task.concluida ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'
                    }`}>
                      {task.concluida && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${task.concluida ? 'line-through text-gray-400' : 'text-gray-800'}`}>{task.titulo}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {task.data_limite && (
                        <span className="text-xs text-gray-400">
                          {format(new Date(task.data_limite), "d MMM HH:mm", { locale: ptBR })}
                        </span>
                      )}
                      {task.responsavel && (
                        <span className="text-xs text-gray-400">{task.responsavel.full_name}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'Negociação' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Preencha estes campos quando o lead estiver na etapa de Negociação.
              </p>
              <Field
                label="Modelo / Serviço"
                value={negotiation.modelo}
                onChange={v => setNegotiation(n => ({ ...n, modelo: v }))}
                placeholder="Ex: Plano Anual, Consultoria..."
              />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Valor da Proposta (R$)"
                  value={negotiation.valor_proposta}
                  onChange={v => setNegotiation(n => ({ ...n, valor_proposta: v }))}
                  type="number"
                  placeholder="0,00"
                />
                <Field
                  label="Valor Negociado (R$)"
                  value={negotiation.valor_negociado}
                  onChange={v => setNegotiation(n => ({ ...n, valor_negociado: v }))}
                  type="number"
                  placeholder="0,00"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.nome.trim()}
            className="px-5 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Salvando...' : isNew ? 'Criar Lead' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Archive confirm modal */}
      {archiveModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Arquivar lead</h3>
            <p className="text-sm text-gray-500 mb-3">Informe o motivo da perda para arquivar este lead. Esta ação não pode ser desfeita.</p>
            <textarea
              value={archiveReason}
              onChange={e => setArchiveReason(e.target.value)}
              placeholder="Motivo da perda *"
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none mb-3"
            />
            <div className="flex gap-2">
              <button onClick={() => setArchiveModal(false)} className="flex-1 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleArchive}
                disabled={!archiveReason.trim()}
                className="flex-1 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors font-medium"
              >
                Arquivar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label, value, onChange, type = 'text', placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300"
      />
    </div>
  )
}
