'use client'

import { useState, useEffect, useRef } from 'react'
import {
  format, startOfWeek, addDays, addWeeks, addMonths, subDays, subWeeks, subMonths,
  startOfMonth, endOfMonth, isSameDay, isSameMonth, isToday,
  parseISO, eachDayOfInterval, isBefore,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { LeadTask, Profile } from '@/types/database'
import { displayName } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import DateTimePicker from '@/components/ui/DateTimePicker'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskWithLead extends Omit<LeadTask, 'responsavel'> {
  responsavel?: Profile | null
  lead?: { id: string; nome: string; sobrenome: string | null } | null
}

interface Props {
  initialTasks: TaskWithLead[]
  profiles: Profile[]
  currentUser: Profile
}

type CalView = 'day' | 'week' | 'month'

// ─── Constants ────────────────────────────────────────────────────────────────

const START_HOUR  = 7
const END_HOUR    = 21
const HOUR_HEIGHT = 64   // px per hour
const EVENT_H     = 52   // px event height

const HOURS       = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
const TOTAL_H     = (END_HOUR - START_HOUR) * HOUR_HEIGHT
const WEEK_SHORT  = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Converte "YYYY-MM-DDTHH:mm" (hora local do input) para ISO UTC
// Usa o construtor posicional do Date, que SEMPRE interpreta como hora local
function localInputToISO(s: string): string {
  const [date, time] = s.split('T')
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi]    = time.split(':').map(Number)
  return new Date(y, mo - 1, d, h, mi, 0, 0).toISOString()
}

function taskColor(task: TaskWithLead) {
  if (task.concluida)
    return { bg: '', text: '', barColor: '#4EB46B', style: { background: 'var(--color-success-subtle)', color: 'var(--color-success-text)' } }
  if (task.data_limite && isBefore(parseISO(task.data_limite), new Date()))
    return { bg: '', text: '', barColor: '#E5484D', style: { background: 'var(--color-danger-subtle)', color: 'var(--color-danger-text)' } }
  return { bg: '', text: '', barColor: '#0098DA', style: { background: 'var(--color-brand-subtle)', color: 'var(--color-brand)' } }
}

function taskTop(dt: Date): number {
  const raw = (dt.getHours() - START_HOUR) * HOUR_HEIGHT + (dt.getMinutes() / 60) * HOUR_HEIGHT
  return Math.max(0, Math.min(raw, TOTAL_H - EVENT_H))
}

function getWeekDays(date: Date): Date[] {
  const start = startOfWeek(date, { weekStartsOn: 0 })
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

function getMonthGrid(date: Date): Date[] {
  const ms = startOfMonth(date)
  const me = endOfMonth(date)
  const gs = startOfWeek(ms, { weekStartsOn: 0 })
  const ge = addDays(startOfWeek(me, { weekStartsOn: 0 }), 6)
  return eachDayOfInterval({ start: gs, end: ge })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgendaClient({ initialTasks, profiles, currentUser }: Props) {
  const supabase = createClient()

  const [view,              setView]              = useState<CalView>('week')
  const [currentDate,       setCurrentDate]       = useState(new Date())
  const [tasks,             setTasks]             = useState<TaskWithLead[]>(initialTasks)
  const [filterResponsavel, setFilterResponsavel] = useState(
    currentUser.perfil !== 'atendente' ? '' : currentUser.id
  )
  const [selectedTask,      setSelectedTask]      = useState<TaskWithLead | null>(null)
  const [showNewForm,       setShowNewForm]       = useState(false)
  const [newFormDate,       setNewFormDate]       = useState<Date | null>(null)
  const [now,               setNow]               = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  async function reloadTasks() {
    const { data } = await supabase
      .from('lead_tasks')
      .select('*, responsavel:profiles(*), lead:leads(id, nome, sobrenome)')
      .not('data_limite', 'is', null)
      .eq('concluida', false)
      .order('data_limite')
    if (data) setTasks(data as TaskWithLead[])
  }

  const filtered = filterResponsavel
    ? tasks.filter(t => t.responsavel_id === filterResponsavel)
    : tasks

  function tasksForDay(day: Date) {
    return filtered.filter(t => t.data_limite && isSameDay(parseISO(t.data_limite), day))
  }

  function prev() {
    if (view === 'day')   setCurrentDate(d => subDays(d, 1))
    if (view === 'week')  setCurrentDate(d => subWeeks(d, 1))
    if (view === 'month') setCurrentDate(d => subMonths(d, 1))
  }
  function next() {
    if (view === 'day')   setCurrentDate(d => addDays(d, 1))
    if (view === 'week')  setCurrentDate(d => addWeeks(d, 1))
    if (view === 'month') setCurrentDate(d => addMonths(d, 1))
  }

  function headerTitle() {
    if (view === 'day')   return format(currentDate, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })
    if (view === 'month') return format(currentDate, "MMMM 'de' yyyy", { locale: ptBR })
    const days  = getWeekDays(currentDate)
    const first = days[0], last = days[6]
    if (first.getMonth() === last.getMonth())
      return `${format(first, 'd')} — ${format(last, "d 'de' MMMM", { locale: ptBR })}`
    return `${format(first, "d MMM", { locale: ptBR })} — ${format(last, "d MMM yyyy", { locale: ptBR })}`
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0 flex-wrap">

        {/* View toggle */}
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-0.5 shrink-0">
          {(['day', 'week', 'month'] as CalView[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                v === view ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {{ day: 'Dia', week: 'Semana', month: 'Mês' }[v]}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={prev}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => setCurrentDate(new Date())}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors font-medium"
          >
            Hoje
          </button>
          <button
            onClick={next}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Period title */}
        <span className="text-sm font-semibold text-gray-800 capitalize flex-1 min-w-0 truncate">{headerTitle()}</span>

        {/* Responsável filter — gestors only */}
        {currentUser.perfil !== 'atendente' && (
          <select
            value={filterResponsavel}
            onChange={e => setFilterResponsavel(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shrink-0"
          >
            <option value="">Todos responsáveis</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
          </select>
        )}

        {/* New task */}
        <button
          onClick={() => { setNewFormDate(null); setShowNewForm(true) }}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl font-medium shrink-0 transition-colors"
          style={{ background: 'var(--color-brand)', color: '#fff', boxShadow: 'var(--shadow-btn-primary)' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nova tarefa
        </button>
      </header>

      {/* ── Calendar body ── */}
      <main className="flex-1 overflow-hidden">
        {view === 'month' && (
          <MonthView
            currentDate={currentDate}
            tasksForDay={tasksForDay}
            onDayClick={d => { setCurrentDate(d); setView('day') }}
            onTaskClick={setSelectedTask}
            onNewTask={d => { setNewFormDate(d); setShowNewForm(true) }}
          />
        )}
        {(view === 'week' || view === 'day') && (
          <TimeGridView
            days={view === 'week' ? getWeekDays(currentDate) : [currentDate]}
            tasksForDay={tasksForDay}
            now={now}
            onTaskClick={setSelectedTask}
            onSlotClick={d => { setNewFormDate(d); setShowNewForm(true) }}
          />
        )}
      </main>

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          profiles={profiles}
          onClose={() => setSelectedTask(null)}
          onUpdated={() => { reloadTasks(); setSelectedTask(null) }}
        />
      )}

      {showNewForm && (
        <NewTaskModal
          defaultDate={newFormDate}
          profiles={profiles}
          currentUser={currentUser}
          onClose={() => setShowNewForm(false)}
          onCreated={() => { reloadTasks(); setShowNewForm(false) }}
        />
      )}
    </div>
  )
}

// ─── Month view ───────────────────────────────────────────────────────────────

function MonthView({
  currentDate,
  tasksForDay,
  onDayClick,
  onTaskClick,
  onNewTask,
}: {
  currentDate: Date
  tasksForDay: (d: Date) => TaskWithLead[]
  onDayClick: (d: Date) => void
  onTaskClick: (t: TaskWithLead) => void
  onNewTask: (d: Date) => void
}) {
  const grid  = getMonthGrid(currentDate)
  const weeks = Math.ceil(grid.length / 7)

  return (
    <div className="h-full flex flex-col bg-white select-none">
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-gray-200 shrink-0">
        {WEEK_SHORT.map(d => (
          <div key={d} className="text-center text-[11px] font-semibold text-gray-400 py-2 uppercase tracking-wide">
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div
        className="flex-1 grid grid-cols-7 overflow-hidden"
        style={{ gridTemplateRows: `repeat(${weeks}, 1fr)` }}
      >
        {grid.map(day => {
          const dayTasks = tasksForDay(day)
          const inMonth  = isSameMonth(day, currentDate)
          const today    = isToday(day)

          return (
            <div
              key={day.toISOString()}
              className={`border-r border-b border-gray-100 p-1.5 flex flex-col gap-0.5 overflow-hidden group ${
                inMonth ? 'bg-white' : 'bg-gray-50/60'
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <button
                  onClick={() => onDayClick(day)}
                  className="w-6 h-6 flex items-center justify-center text-xs font-semibold rounded-full transition-colors"
                  style={
                    today
                      ? { background: 'var(--color-brand)', color: '#fff' }
                      : inMonth
                        ? { color: 'var(--color-ink)' }
                        : { color: 'var(--color-muted)' }
                  }
                >
                  {format(day, 'd')}
                </button>
                <button
                  onClick={() => onNewTask(day)}
                  className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-all text-sm leading-none"
                >
                  +
                </button>
              </div>

              {dayTasks.slice(0, 3).map(task => {
                const c = taskColor(task)
                return (
                  <button
                    key={task.id}
                    onClick={() => onTaskClick(task)}
                    className="w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate font-medium border"
                    style={{ ...c.style, borderColor: c.barColor + '55' }}
                  >
                    {task.data_limite && (
                      <span className="opacity-70 mr-1">{format(parseISO(task.data_limite), 'HH:mm')}</span>
                    )}
                    {task.titulo}
                  </button>
                )
              })}

              {dayTasks.length > 3 && (
                <button
                  onClick={() => onDayClick(day)}
                  className="text-[10px] text-gray-400 hover:text-blue-500 text-left pl-1 transition-colors"
                >
                  +{dayTasks.length - 3} mais
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Time grid (Day + Week) ───────────────────────────────────────────────────

function TimeGridView({
  days,
  tasksForDay,
  now,
  onTaskClick,
  onSlotClick,
}: {
  days: Date[]
  tasksForDay: (d: Date) => TaskWithLead[]
  now: Date
  onTaskClick: (t: TaskWithLead) => void
  onSlotClick: (d: Date) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!gridRef.current) return
    const todayVisible = days.some(d => isToday(d))
    const nowTop = (now.getHours() - START_HOUR) * HOUR_HEIGHT + (now.getMinutes() / 60) * HOUR_HEIGHT
    gridRef.current.scrollTop = todayVisible ? Math.max(0, nowTop - 120) : HOUR_HEIGHT
  }, [days[0].toDateString()]) // eslint-disable-line

  const nowTop = (now.getHours() - START_HOUR) * HOUR_HEIGHT + (now.getMinutes() / 60) * HOUR_HEIGHT

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Day headers */}
      <div className="flex border-b border-gray-200 shrink-0">
        <div className="w-14 shrink-0" />
        {days.map(day => (
          <div key={day.toISOString()} className="flex-1 text-center py-2 border-l border-gray-100">
            <div className="text-[10px] uppercase font-semibold text-gray-400 tracking-wide">
              {format(day, 'EEE', { locale: ptBR })}
            </div>
            <div
              className="text-lg font-bold mx-auto w-8 h-8 flex items-center justify-center rounded-full"
              style={isToday(day) ? { background: 'var(--color-brand)', color: '#fff' } : { color: 'var(--color-ink)' }}
            >
              {format(day, 'd')}
            </div>
          </div>
        ))}
      </div>

      {/* Scrollable grid */}
      <div ref={gridRef} className="flex-1 overflow-y-auto">
        <div className="flex" style={{ height: `${TOTAL_H}px` }}>

          {/* Hour labels */}
          <div className="w-14 shrink-0 relative select-none">
            {HOURS.map(h => (
              <div
                key={h}
                className="absolute right-2 text-[10px] text-gray-400"
                style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT - 8}px` }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map(day => {
            const dayTasks = tasksForDay(day)
            const showNow  = isToday(day) && nowTop >= 0 && nowTop <= TOTAL_H

            return (
              <div
                key={day.toISOString()}
                className="flex-1 relative border-l border-gray-100 cursor-crosshair"
                onClick={e => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const y    = e.clientY - rect.top
                  const h    = Math.floor(y / HOUR_HEIGHT) + START_HOUR
                  const m    = Math.round(((y % HOUR_HEIGHT) / HOUR_HEIGHT) * 60 / 15) * 15
                  const d    = new Date(day)
                  d.setHours(Math.min(h, END_HOUR - 1), Math.min(m, 45), 0, 0)
                  onSlotClick(d)
                }}
              >
                {/* Hour lines */}
                {HOURS.map(h => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-gray-100 pointer-events-none"
                    style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT}px` }}
                  />
                ))}
                {/* Half-hour lines */}
                {HOURS.map(h => (
                  <div
                    key={`h-${h}`}
                    className="absolute inset-x-0 pointer-events-none"
                    style={{
                      top: `${(h - START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2}px`,
                      borderTop: '1px dashed #f3f4f6',
                    }}
                  />
                ))}

                {/* Now line */}
                {showNow && (
                  <div
                    className="absolute inset-x-0 z-20 pointer-events-none"
                    style={{ top: `${nowTop}px` }}
                  >
                    <div className="relative flex items-center">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--color-danger)' }} />
                      <div className="flex-1 border-t-2" style={{ borderColor: 'var(--color-danger)' }} />
                    </div>
                  </div>
                )}

                {/* Events */}
                {dayTasks.map(task => {
                  const dt  = parseISO(task.data_limite!)
                  const top = taskTop(dt)
                  const c   = taskColor(task)
                  return (
                    <div
                      key={task.id}
                      className="absolute left-1 right-1 rounded-lg px-2 py-1 cursor-pointer hover:z-10 hover:shadow-md transition-shadow"
                      style={{
                        ...c.style,
                        top: `${top}px`,
                        height: `${EVENT_H}px`,
                        borderLeft: `3px solid ${c.barColor}`,
                      }}
                      onClick={e => { e.stopPropagation(); onTaskClick(task) }}
                    >
                      <p className={`text-[11px] font-semibold truncate ${task.concluida ? 'line-through opacity-60' : ''}`}>
                        {format(dt, 'HH:mm')} · {task.titulo}
                      </p>
                      {task.lead && (
                        <p className="text-[10px] truncate opacity-75 mt-0.5">
                          {task.lead.nome}{task.lead.sobrenome ? ` ${task.lead.sobrenome}` : ''}
                        </p>
                      )}
                      {task.responsavel && (
                        <p className="text-[10px] truncate opacity-60">
                          {displayName(task.responsavel)}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Task detail modal ────────────────────────────────────────────────────────

function TaskDetailModal({
  task,
  profiles,
  onClose,
  onUpdated,
}: {
  task: TaskWithLead
  profiles: Profile[]
  onClose: () => void
  onUpdated: () => void
}) {
  const supabase = createClient()
  const [editing, setEditing] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [form,    setForm]    = useState({
    titulo:         task.titulo,
    data_limite:    task.data_limite ? format(new Date(task.data_limite), "yyyy-MM-dd'T'HH:mm") : '',
    responsavel_id: task.responsavel_id ?? '',
    descricao:      task.descricao ?? '',
  })

  const overdue = !task.concluida && task.data_limite && isBefore(parseISO(task.data_limite), new Date())

  async function handleToggle() {
    await supabase.from('lead_tasks').update({ concluida: !task.concluida }).eq('id', task.id)
    onUpdated()
  }

  async function handleSave() {
    setSaving(true)
    await supabase.from('lead_tasks').update({
      titulo:         form.titulo,
      data_limite:    form.data_limite ? localInputToISO(form.data_limite) : null,
      responsavel_id: form.responsavel_id || null,
      descricao:      form.descricao || null,
    }).eq('id', task.id)
    setSaving(false)
    onUpdated()
  }

  async function handleDelete() {
    await supabase.from('lead_tasks').delete().eq('id', task.id)
    onUpdated()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div
              className={`w-3 h-3 rounded-full mt-1 shrink-0 ${
                task.concluida ? 'bg-emerald-400' : overdue ? 'bg-red-400' : 'bg-blue-400'
              }`}
            />
            <div className="flex-1 min-w-0">
              {editing ? (
                <input
                  autoFocus
                  value={form.titulo}
                  onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                  className="w-full text-base font-semibold text-gray-900 border-b border-blue-300 focus:outline-none pb-0.5 bg-transparent"
                />
              ) : (
                <h3 className={`text-base font-semibold text-gray-900 ${task.concluida ? 'line-through text-gray-400' : ''}`}>
                  {task.titulo}
                </h3>
              )}
              {task.lead && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {task.lead.nome}{task.lead.sobrenome ? ` ${task.lead.sobrenome}` : ''}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition-colors shrink-0 ml-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {editing ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Data e hora</label>
                <DateTimePicker
                  value={form.data_limite}
                  onChange={v => setForm(f => ({ ...f, data_limite: v }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Responsável</label>
                <select
                  value={form.responsavel_id}
                  onChange={e => setForm(f => ({ ...f, responsavel_id: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Sem responsável</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descrição</label>
                <textarea
                  value={form.descricao}
                  onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  rows={2}
                  placeholder="Detalhes adicionais..."
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </>
          ) : (
            <>
              {task.data_limite && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className={overdue ? 'text-red-600 font-medium' : ''}>
                    {format(parseISO(task.data_limite), "EEEE, d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                    {overdue && ' · Vencida'}
                  </span>
                </div>
              )}
              {task.responsavel && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {displayName(task.responsavel)}
                </div>
              )}
              {task.descricao && (
                <p className="text-sm text-gray-600 bg-gray-50 rounded-xl px-3 py-2">{task.descricao}</p>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 pb-5">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving || !form.titulo.trim()}
                className="flex-1 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-40 transition-colors" style={{ background: 'var(--color-brand)' }}
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="py-2 px-4 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
            </>
          ) : confirm ? (
            <>
              <p className="text-xs text-gray-500 flex-1">Excluir esta tarefa?</p>
              <button onClick={handleDelete} className="py-1.5 px-3 bg-red-500 text-white rounded-xl text-xs font-medium hover:bg-red-600 transition-colors">
                Confirmar
              </button>
              <button onClick={() => setConfirm(false)} className="py-1.5 px-3 border border-gray-200 text-gray-600 rounded-xl text-xs hover:bg-gray-50 transition-colors">
                Não
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleToggle}
                className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
                style={task.concluida
                  ? { border: '1px solid var(--color-border)', color: 'var(--color-text)' }
                  : { background: 'var(--color-success)', color: '#fff' }
                }
              >
                {task.concluida ? 'Reabrir' : 'Concluir'}
              </button>
              <button
                onClick={() => setEditing(true)}
                className="py-2 px-4 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Editar
              </button>
              <button
                onClick={() => setConfirm(true)}
                className="py-2 px-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                title="Excluir"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── New task modal ───────────────────────────────────────────────────────────

type LeadOption = { id: string; nome: string; sobrenome: string | null }

function NewTaskModal({
  defaultDate,
  profiles,
  currentUser,
  onClose,
  onCreated,
}: {
  defaultDate: Date | null
  profiles: Profile[]
  currentUser: Profile
  onClose: () => void
  onCreated: () => void
}) {
  const supabase = createClient()

  const [form, setForm] = useState({
    titulo:         '',
    data_limite:    defaultDate ? format(defaultDate, "yyyy-MM-dd'T'HH:mm") : '',
    responsavel_id: currentUser.id,
    descricao:      '',
  })
  const [leadQuery,    setLeadQuery]    = useState('')
  const [leadResults,  setLeadResults]  = useState<LeadOption[]>([])
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [saving,       setSaving]       = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleLeadInput(q: string) {
    setLeadQuery(q)
    setSelectedLead(null)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (q.length < 2) { setLeadResults([]); setShowDropdown(false); return }
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('leads')
        .select('id, nome, sobrenome')
        .ilike('nome', `%${q}%`)
        .eq('arquivado', false)
        .limit(6)
      setLeadResults((data ?? []) as LeadOption[])
      setShowDropdown(true)
    }, 300)
  }

  function selectLead(lead: LeadOption) {
    setSelectedLead(lead)
    setLeadQuery(`${lead.nome}${lead.sobrenome ? ` ${lead.sobrenome}` : ''}`)
    setShowDropdown(false)
    setLeadResults([])
  }

  async function handleCreate() {
    if (!form.titulo.trim() || !selectedLead) return
    setSaving(true)
    await supabase.from('lead_tasks').insert({
      lead_id:        selectedLead.id,
      titulo:         form.titulo,
      data_limite:    form.data_limite ? localInputToISO(form.data_limite) : null,
      responsavel_id: form.responsavel_id || null,
      descricao:      form.descricao || null,
      concluida:      false,
    })
    setSaving(false)
    onCreated()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Nova tarefa</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Título *</label>
            <input
              autoFocus
              value={form.titulo}
              onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
              placeholder="Ex: Retorno vacina gripe"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Lead search */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 mb-1">Contato *</label>
            <input
              value={leadQuery}
              onChange={e => handleLeadInput(e.target.value)}
              placeholder="Buscar por nome..."
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {selectedLead && (
              <div className="absolute right-3 top-[34px] text-emerald-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
            {showDropdown && leadResults.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
                {leadResults.map(l => (
                  <button
                    key={l.id}
                    onClick={() => selectLead(l)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors"
                  >
                    {l.nome}{l.sobrenome ? ` ${l.sobrenome}` : ''}
                  </button>
                ))}
              </div>
            )}
            {showDropdown && leadResults.length === 0 && leadQuery.length >= 2 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg px-3 py-2 text-xs text-gray-400">
                Nenhum contato encontrado
              </div>
            )}
          </div>

          {/* Date/time */}
          <DateTimePicker
            value={form.data_limite}
            onChange={v => setForm(f => ({ ...f, data_limite: v }))}
            label="Data e hora"
          />

          {/* Responsible */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Responsável</label>
            <select
              value={form.responsavel_id}
              onChange={e => setForm(f => ({ ...f, responsavel_id: e.target.value }))}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {profiles.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Descrição (opcional)</label>
            <textarea
              value={form.descricao}
              onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
              rows={2}
              placeholder="Observações..."
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={handleCreate}
            disabled={saving || !form.titulo.trim() || !selectedLead}
            className="flex-1 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-40 transition-colors" style={{ background: 'var(--color-brand)' }}
          >
            {saving ? 'Criando…' : 'Criar tarefa'}
          </button>
          <button
            onClick={onClose}
            className="py-2 px-4 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
