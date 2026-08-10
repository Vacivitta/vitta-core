'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, isPast, differenceInMinutes, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { displayName } from '@/types/database'
import type { Profile, LeadTask } from '@/types/database'
import Drawer from '@/components/ui/Drawer'

interface TaskWithLead extends Omit<LeadTask, 'responsavel'> {
  lead:        { id: string; nome: string; sobrenome: string | null } | null
  responsavel: Pick<Profile, 'id' | 'full_name' | 'apelido'> | null
}

type Filter = 'pendentes' | 'concluidas' | 'todas'

interface Props {
  open:        boolean
  onClose:     () => void
  profiles:    Pick<Profile, 'id' | 'full_name' | 'apelido'>[]
  currentUser: Profile
}

function statusOf(t: TaskWithLead): 'concluida' | 'expirada' | 'expirando' | 'pendente' {
  if (t.concluida) return 'concluida'
  if (!t.data_limite) return 'pendente'
  const dt = parseISO(t.data_limite)
  if (isPast(dt)) return 'expirada'
  if (differenceInMinutes(dt, new Date()) <= 30) return 'expirando'
  return 'pendente'
}

const STATUS_LABEL: Record<string, string> = {
  concluida: 'Concluída',
  expirada:  'Expirada',
  expirando: 'Expirando',
  pendente:  'Pendente',
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  concluida: { background: '#E8F4E6', color: '#35853F' },
  expirada:  { background: '#F6DFD5', color: '#C05B3A' },
  expirando: { background: '#FCF3E4', color: '#C87F1B' },
  pendente:  { background: '#DCEFFA', color: '#1E86C0' },
}

export default function TarefasPanel({ open, onClose, profiles, currentUser }: Props) {
  const supabase = createClient()

  const [tasks,          setTasks]          = useState<TaskWithLead[]>([])
  const [loaded,         setLoaded]         = useState(false)
  const [filter,         setFilter]         = useState<Filter>('pendentes')
  const [responsavelFil, setResponsavelFil] = useState<string>('todos')
  const [search,         setSearch]         = useState('')

  const [concludingId,   setConcludingId]   = useState<string | null>(null)
  const [obsText,        setObsText]        = useState('')
  const [saving,         setSaving]         = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const loadTasks = useCallback(async () => {
    const { data } = await supabase
      .from('lead_tasks')
      .select('*, responsavel:profiles(id, full_name, apelido), lead:leads(id, nome, sobrenome)')
      .eq('unit_id', currentUser.unit_id)
      .order('concluida', { ascending: true })
      .order('data_limite', { ascending: true, nullsFirst: false })
    if (data) setTasks(data as TaskWithLead[])
    setLoaded(true)
  }, [supabase, currentUser.unit_id])

  useEffect(() => {
    if (open && !loaded) loadTasks()
  }, [open, loaded, loadTasks])

  useEffect(() => {
    if (!open) { setLoaded(false); return }
    const channel = supabase
      .channel('tarefas-panel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lead_tasks' }, async payload => {
        if (payload.eventType === 'DELETE') {
          setTasks(prev => prev.filter(t => t.id !== (payload.old as LeadTask).id))
          return
        }
        const { data } = await supabase
          .from('lead_tasks')
          .select('*, responsavel:profiles(id, full_name, apelido), lead:leads(id, nome, sobrenome)')
          .eq('id', (payload.new as LeadTask).id)
          .single()
        if (!data) return
        const task = data as TaskWithLead
        setTasks(prev => {
          const idx = prev.findIndex(t => t.id === task.id)
          if (idx === -1) return [task, ...prev]
          const next = [...prev]
          next[idx] = task
          return next
        })
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [open, supabase])

  useEffect(() => {
    if (concludingId) setTimeout(() => textareaRef.current?.focus(), 50)
  }, [concludingId])

  const filtered = useMemo(() => {
    let list = tasks
    if (filter === 'pendentes') list = list.filter(t => !t.concluida)
    if (filter === 'concluidas') list = list.filter(t => t.concluida)
    if (responsavelFil !== 'todos') list = list.filter(t => t.responsavel_id === responsavelFil)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        t.titulo.toLowerCase().includes(q) ||
        (t.descricao ?? '').toLowerCase().includes(q) ||
        `${t.lead?.nome ?? ''} ${t.lead?.sobrenome ?? ''}`.toLowerCase().includes(q) ||
        (t.responsavel ? displayName(t.responsavel) : '').toLowerCase().includes(q)
      )
    }
    if (filter !== 'concluidas') {
      list = [...list].sort((a, b) => {
        const sa = statusOf(a), sb = statusOf(b)
        if (sa === 'expirada' && sb !== 'expirada') return -1
        if (sb === 'expirada' && sa !== 'expirada') return 1
        if (!a.data_limite) return 1
        if (!b.data_limite) return -1
        return new Date(a.data_limite).getTime() - new Date(b.data_limite).getTime()
      })
    } else {
      list = [...list].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    }
    return list
  }, [tasks, filter, responsavelFil, search])

  const counts = useMemo(() => ({
    pendentes:  tasks.filter(t => !t.concluida).length,
    concluidas: tasks.filter(t => t.concluida).length,
    todas:      tasks.length,
  }), [tasks])

  function openConclude(id: string) {
    const task = tasks.find(t => t.id === id)
    setConcludingId(id)
    setObsText(task?.observacao_conclusao ?? '')
  }

  async function handleToggle(id: string, concluida: boolean, obs: string) {
    setSaving(true)
    await supabase.from('lead_tasks').update({
      concluida,
      observacao_conclusao: obs.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setSaving(false)
    setConcludingId(null)
    setObsText('')
  }

  const concludingTask = tasks.find(t => t.id === concludingId)

  return (
    <Drawer open={open} onClose={onClose} title="Tarefas" width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', margin: '-20px -20px 0' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E9E5D8' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div>
              <p style={{ fontSize: '11.5px', fontWeight: 600, color: '#9AA79C', margin: 0 }}>
                {counts.pendentes} pendente{counts.pendentes !== 1 ? 's' : ''}
                {tasks.filter(t => !t.concluida && t.data_limite && isPast(parseISO(t.data_limite))).length > 0 && (
                  <> · <span style={{ color: '#C05B3A' }}>{tasks.filter(t => !t.concluida && t.data_limite && isPast(parseISO(t.data_limite))).length} expirada{tasks.filter(t => !t.concluida && t.data_limite && isPast(parseISO(t.data_limite))).length !== 1 ? 's' : ''}</span></>
                )}
              </p>
            </div>

            {/* Busca */}
            <div style={{ position: 'relative', width: '220px' }}>
              <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9AA79C' }}
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar tarefa ou cliente…"
                style={{
                  width: '100%', paddingLeft: '30px', paddingRight: '12px', paddingTop: '7px', paddingBottom: '7px',
                  border: '1px solid #EBE7DA', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                  color: '#35543B', background: '#F6F4EC', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Filtros */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '5px', flex: 1 }}>
              {(['pendentes', 'concluidas', 'todas'] as Filter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    padding: '6px 12px', borderRadius: '999px', border: 'none', cursor: 'pointer',
                    fontSize: '11.5px', fontWeight: filter === f ? 800 : 700, transition: 'all 0.15s',
                    background: filter === f ? '#25402C' : '#F1EFE5',
                    color: filter === f ? '#fff' : '#71856F',
                  }}
                >
                  {f === 'pendentes' ? 'Pendentes' : f === 'concluidas' ? 'Concluídas' : 'Todas'}
                  <span style={{
                    marginLeft: '5px', fontSize: '10px', fontWeight: 800,
                    background: filter === f ? 'rgba(255,255,255,0.22)' : '#E3DFD0',
                    color: filter === f ? '#fff' : '#71856F',
                    padding: '1px 6px', borderRadius: '999px',
                  }}>
                    {counts[f]}
                  </span>
                </button>
              ))}
            </div>

            <select
              value={responsavelFil}
              onChange={e => setResponsavelFil(e.target.value)}
              style={{
                padding: '6px 10px', border: '1px solid #EBE7DA', borderRadius: '999px',
                fontSize: '11.5px', fontWeight: 700, color: '#71856F', background: '#fff', cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="todos">Todos</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{displayName(p)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Lista */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          {!loaded ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9AA79C', fontSize: '13px', fontWeight: 600 }}>
              Carregando…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9AA79C' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 10px', display: 'block' }}>
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/>
                <path d="m9 12 2 2 4-4"/>
              </svg>
              <p style={{ margin: 0, fontSize: '12.5px', fontWeight: 600 }}>
                {filter === 'pendentes' ? 'Nenhuma tarefa pendente' : filter === 'concluidas' ? 'Nenhuma tarefa concluída' : 'Nenhuma tarefa encontrada'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {filtered.map(task => {
                const st = statusOf(task)
                const clientName = task.lead
                  ? `${task.lead.nome}${task.lead.sobrenome ? ' ' + task.lead.sobrenome : ''}`
                  : '—'
                return (
                  <div
                    key={task.id}
                    style={{
                      background: '#fff',
                      border: '1px solid #EBE7DA',
                      borderRadius: '14px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                      opacity: task.concluida ? 0.72 : 1,
                      transition: 'box-shadow 0.15s',
                    }}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => {
                        if (task.concluida) {
                          void handleToggle(task.id, false, task.observacao_conclusao ?? '')
                        } else {
                          openConclude(task.id)
                        }
                      }}
                      title={task.concluida ? 'Reabrir tarefa' : 'Marcar como feita'}
                      style={{
                        width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0, marginTop: '2px',
                        border: task.concluida ? 'none' : '2px solid #C9C3B2',
                        background: task.concluida ? '#3E9849' : 'transparent',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {task.concluida && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </button>

                    {/* Conteúdo */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap', marginBottom: '3px' }}>
                        <span style={{
                          fontSize: '13px', fontWeight: 800, color: '#25402C',
                          textDecoration: task.concluida ? 'line-through' : 'none',
                        }}>
                          {task.titulo}
                        </span>
                        <span style={{
                          fontSize: '10px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px',
                          ...STATUS_STYLE[st],
                        }}>
                          {STATUS_LABEL[st]}
                        </span>
                      </div>

                      {task.descricao && (
                        <p style={{ margin: '0 0 5px', fontSize: '11.5px', fontWeight: 600, color: '#71856F', lineHeight: '1.4' }}>
                          {task.descricao}
                        </p>
                      )}

                      {task.observacao_conclusao && (
                        <p style={{ margin: '0 0 5px', fontSize: '11.5px', color: '#71856F', fontStyle: 'italic', background: '#FBFAF4', padding: '5px 9px', borderRadius: '0 8px 8px 0', borderLeft: '3px solid #CDE8CB' }}>
                          {task.observacao_conclusao}
                        </p>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '11px', fontWeight: 700, color: '#9AA79C' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#D6EBD2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 800, color: '#35853F', flexShrink: 0 }}>
                            {(task.lead?.nome ?? '—')[0].toUpperCase()}
                          </span>
                          <span style={{ color: '#35543B' }}>{clientName}</span>
                        </span>

                        {task.data_limite && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: st === 'expirada' ? '#C05B3A' : st === 'expirando' ? '#C87F1B' : '#9AA79C' }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                            </svg>
                            {format(parseISO(task.data_limite), "d 'de' MMM 'às' HH:mm", { locale: ptBR })}
                          </span>
                        )}

                        {task.responsavel && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                            </svg>
                            {displayName(task.responsavel)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Botão de ação */}
                    <button
                      onClick={() => {
                        if (task.concluida) {
                          void handleToggle(task.id, false, task.observacao_conclusao ?? '')
                        } else {
                          openConclude(task.id)
                        }
                      }}
                      style={{
                        flexShrink: 0, padding: '5px 12px', borderRadius: '999px', cursor: 'pointer',
                        fontSize: '11.5px', fontWeight: 800, transition: 'all 0.15s',
                        background: task.concluida ? 'transparent' : '#3E9849',
                        color: task.concluida ? '#71856F' : '#fff',
                        border: task.concluida ? '1px solid #EBE7DA' : 'none',
                      }}
                    >
                      {task.concluida ? 'Reabrir' : 'Concluir'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Modal de conclusão inline */}
        {concludingId && concludingTask && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              background: '#fff', borderRadius: 16, padding: '20px', width: '90%', maxWidth: 380,
              boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
            }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 800, color: '#25402C' }}>
                Concluir tarefa
              </h3>

              <div style={{ background: '#FBFAF4', borderRadius: 12, padding: '10px 12px', marginBottom: 14, border: '1px solid #EBE7DA' }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#25402C' }}>
                  {concludingTask.titulo}
                </p>
                {concludingTask.lead && (
                  <p style={{ margin: '3px 0 0', fontSize: '11px', fontWeight: 600, color: '#9AA79C' }}>
                    {concludingTask.lead.nome}{concludingTask.lead.sobrenome ? ' ' + concludingTask.lead.sobrenome : ''}
                  </p>
                )}
              </div>

              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#71856F', marginBottom: '5px' }}>
                Observação <span style={{ fontWeight: 600, color: '#9AA79C' }}>(opcional)</span>
              </label>
              <textarea
                ref={textareaRef}
                value={obsText}
                onChange={e => setObsText(e.target.value)}
                placeholder="Observação de conclusão…"
                rows={3}
                style={{
                  width: '100%', padding: '9px 11px', border: '1px solid #EBE7DA', borderRadius: '10px',
                  fontSize: '12.5px', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                  fontFamily: 'inherit', lineHeight: '1.5', color: '#25402C',
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button
                  onClick={() => setConcludingId(null)}
                  disabled={saving}
                  style={{ padding: '8px 16px', borderRadius: '999px', border: '1px solid #EBE7DA', background: '#fff', color: '#71856F', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={() => concludingId && void handleToggle(concludingId, true, obsText)}
                  disabled={saving}
                  style={{ padding: '8px 16px', borderRadius: '999px', border: 'none', background: '#3E9849', color: '#fff', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer', boxShadow: '0 5px 14px -6px rgba(62,152,73,0.55)' }}
                >
                  {saving ? 'Salvando…' : 'Concluir'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}
