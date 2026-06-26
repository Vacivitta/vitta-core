'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, isPast, differenceInMinutes, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { displayName } from '@/types/database'
import type { Profile, LeadTask } from '@/types/database'

export interface TaskWithLead extends Omit<LeadTask, 'responsavel'> {
  lead:        { id: string; nome: string; sobrenome: string | null } | null
  responsavel: Pick<Profile, 'id' | 'full_name' | 'apelido'> | null
}

type Filter = 'pendentes' | 'concluidas' | 'todas'

interface Props {
  initialTasks: TaskWithLead[]
  profiles:     Pick<Profile, 'id' | 'full_name' | 'apelido'>[]
  currentUser:  Profile
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
  concluida: { background: '#DCFCE7', color: '#166534' },
  expirada:  { background: '#FEE2E2', color: '#991B1B' },
  expirando: { background: '#FEF9C3', color: '#854D0E' },
  pendente:  { background: '#DBEAFE', color: '#1E40AF' },
}

export default function TarefasClient({ initialTasks, profiles, currentUser }: Props) {
  const supabase = createClient()

  const [tasks,          setTasks]          = useState<TaskWithLead[]>(initialTasks)
  const [filter,         setFilter]         = useState<Filter>('pendentes')
  const [responsavelFil, setResponsavelFil] = useState<string>('todos')
  const [search,         setSearch]         = useState('')

  // Modal de conclusão
  const [concludingId,   setConcludingId]   = useState<string | null>(null)
  const [obsText,        setObsText]        = useState('')
  const [saving,         setSaving]         = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('tarefas-global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lead_tasks' }, async payload => {
        if (payload.eventType === 'DELETE') {
          setTasks(prev => prev.filter(t => t.id !== (payload.old as LeadTask).id))
          return
        }
        // Busca tarefa completa com joins
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
  }, [supabase])

  // Foco no textarea ao abrir modal
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
    // Pendentes: expiradas primeiro, depois por data; concluídas: mais recentes primeiro
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg-subtle, #F8FAFC)' }}>

      {/* Header */}
      <div style={{ padding: '24px 28px 0', background: '#fff', borderBottom: '1px solid var(--color-border, #E2E8F0)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#0F1A24', margin: 0 }}>Tarefas</h1>

          {/* Busca */}
          <div style={{ position: 'relative', width: '280px' }}>
            <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }}
              width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar tarefa ou cliente..."
              style={{
                width: '100%', paddingLeft: '32px', paddingRight: '12px', paddingTop: '8px', paddingBottom: '8px',
                border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Abas de status */}
          <div style={{ display: 'flex', gap: '2px', flex: 1 }}>
            {(['pendentes', 'concluidas', 'todas'] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '8px 14px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 600, transition: 'all 0.15s',
                  background: filter === f ? '#0098DA' : 'transparent',
                  color: filter === f ? '#fff' : '#64748B',
                }}
              >
                {f === 'pendentes' ? 'Pendentes' : f === 'concluidas' ? 'Concluídas' : 'Todas'}
                <span style={{
                  marginLeft: '6px', fontSize: '11px', fontWeight: 700,
                  background: filter === f ? 'rgba(255,255,255,0.25)' : '#E2E8F0',
                  color: filter === f ? '#fff' : '#64748B',
                  padding: '1px 6px', borderRadius: '10px',
                }}>
                  {counts[f]}
                </span>
              </button>
            ))}
          </div>

          {/* Filtro por responsável */}
          <select
            value={responsavelFil}
            onChange={e => setResponsavelFil(e.target.value)}
            style={{
              padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: '8px',
              fontSize: '13px', color: '#374151', background: '#fff', cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="todos">Todos os responsáveis</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>{displayName(p)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Lista */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 28px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 12px', display: 'block' }}>
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
              <rect x="9" y="3" width="6" height="4" rx="1"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
            <p style={{ margin: 0, fontSize: '14px' }}>
              {filter === 'pendentes' ? 'Nenhuma tarefa pendente' : filter === 'concluidas' ? 'Nenhuma tarefa concluída' : 'Nenhuma tarefa encontrada'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                    border: '1px solid #E2E8F0',
                    borderRadius: '12px',
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '14px',
                    opacity: task.concluida ? 0.75 : 1,
                    transition: 'box-shadow 0.15s',
                  }}
                >
                  {/* Checkbox visual */}
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
                      border: task.concluida ? '2px solid #22C55E' : '2px solid #CBD5E1',
                      background: task.concluida ? '#22C55E' : 'transparent',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {task.concluida && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </button>

                  {/* Conteúdo */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <span style={{
                        fontSize: '14px', fontWeight: 600, color: '#0F1A24',
                        textDecoration: task.concluida ? 'line-through' : 'none',
                      }}>
                        {task.titulo}
                      </span>
                      <span style={{
                        fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                        ...STATUS_STYLE[st],
                      }}>
                        {STATUS_LABEL[st]}
                      </span>
                    </div>

                    {task.descricao && (
                      <p style={{ margin: '0 0 6px', fontSize: '13px', color: '#64748B', lineHeight: '1.4' }}>
                        {task.descricao}
                      </p>
                    )}

                    {task.observacao_conclusao && (
                      <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#6B7280', fontStyle: 'italic', background: '#F9FAFB', padding: '6px 10px', borderRadius: '6px', borderLeft: '3px solid #E2E8F0' }}>
                        {task.observacao_conclusao}
                      </p>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: '#94A3B8' }}>
                      {/* Cliente */}
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                        </svg>
                        <span style={{ color: '#374151', fontWeight: 500 }}>{clientName}</span>
                      </span>

                      {/* Data/hora */}
                      {task.data_limite && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: st === 'expirada' ? '#EF4444' : st === 'expirando' ? '#F59E0B' : '#94A3B8' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                          </svg>
                          {format(parseISO(task.data_limite), "d 'de' MMM 'às' HH:mm", { locale: ptBR })}
                        </span>
                      )}

                      {/* Responsável */}
                      {task.responsavel && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                      flexShrink: 0, padding: '6px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                      fontSize: '12px', fontWeight: 600, transition: 'all 0.15s',
                      background: task.concluida ? '#F1F5F9' : '#0098DA',
                      color: task.concluida ? '#64748B' : '#fff',
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

      {/* Modal de conclusão */}
      {concludingId && concludingTask && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={e => { if (e.target === e.currentTarget) setConcludingId(null) }}
        >
          <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', width: '420px', boxShadow: '0 20px 60px -10px rgba(0,0,0,0.25)' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700, color: '#0F1A24' }}>
              Concluir tarefa
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#64748B' }}>
              {concludingTask.titulo}
              {concludingTask.lead && (
                <> · <strong style={{ color: '#374151' }}>
                  {concludingTask.lead.nome}{concludingTask.lead.sobrenome ? ' ' + concludingTask.lead.sobrenome : ''}
                </strong></>
              )}
            </p>

            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
              Observação <span style={{ fontWeight: 400, color: '#94A3B8' }}>(opcional)</span>
            </label>
            <textarea
              ref={textareaRef}
              value={obsText}
              onChange={e => setObsText(e.target.value)}
              placeholder="Ex: Cliente confirmou presença, reagendado para..."
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '8px',
                fontSize: '13px', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                fontFamily: 'inherit', lineHeight: '1.5',
              }}
            />

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConcludingId(null)}
                disabled={saving}
                style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #E2E8F0', background: '#fff', color: '#374151', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleToggle(concludingId, true, obsText)}
                disabled={saving}
                style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#22C55E', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                {saving ? 'Salvando...' : 'Marcar como feita'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
