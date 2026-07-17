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
import Drawer from '@/components/ui/Drawer'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskWithLead extends Omit<LeadTask, 'responsavel'> {
  responsavel?: Profile | null
  lead?: { id: string; nome: string; sobrenome: string | null } | null
}

export interface ScheduledMsg {
  id:              string
  conversation_id: string
  content:         string | null
  type:            'text' | 'template'
  template_name:   string | null
  scheduled_for:   string
  status:          'pending' | 'sent' | 'failed'
  created_by:      string | null
  conversation:    { wa_contact_name: string | null; lead: { nome: string; sobrenome: string | null } | null } | null
}

// Item unificado para exibição no calendário (tarefa ou mensagem agendada)
type AgendaItem =
  | { kind: 'task';    id: string; date: string; task: TaskWithLead }
  | { kind: 'message'; id: string; date: string; message: ScheduledMsg }

interface Props {
  initialTasks: TaskWithLead[]
  initialMessages: ScheduledMsg[]
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
    return { bg: '', text: '', barColor: '#9AA79C', style: { background: '#F1EFE5', color: '#71856F' } }
  if (task.data_limite && isBefore(parseISO(task.data_limite), new Date()))
    return { bg: '', text: '', barColor: '#C05B3A', style: { background: '#F6DFD5', color: '#8F3F24' } }
  return { bg: '', text: '', barColor: '#3E9849', style: { background: '#D6EBD2', color: '#25402C' } }
}

function msgColor(msg: ScheduledMsg) {
  if (msg.status === 'sent')
    return { barColor: '#9AA79C', style: { background: '#F1EFE5', color: '#71856F' } }
  if (msg.status === 'failed')
    return { barColor: '#C05B3A', style: { background: '#F6DFD5', color: '#8F3F24' } }
  return { barColor: '#1E86C0', style: { background: '#DCEFFA', color: '#14608C' } }
}

function itemColor(item: AgendaItem) {
  return item.kind === 'task' ? taskColor(item.task) : msgColor(item.message)
}

function itemDate(item: AgendaItem): Date {
  return parseISO(item.date)
}

function itemTitle(item: AgendaItem): string {
  if (item.kind === 'task') return item.task.titulo
  if (item.message.type === 'template') return `📋 ${item.message.template_name ?? 'Template'}`
  return item.message.content ?? 'Mensagem agendada'
}

function itemSubtitle(item: AgendaItem): string | null {
  if (item.kind === 'task') {
    const lead = item.task.lead
    return lead ? `${lead.nome}${lead.sobrenome ? ` ${lead.sobrenome}` : ''}` : null
  }
  const conv = item.message.conversation
  if (!conv) return null
  if (conv.lead) return `${conv.lead.nome}${conv.lead.sobrenome ? ` ${conv.lead.sobrenome}` : ''}`
  return conv.wa_contact_name
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

export default function AgendaClient({ initialTasks, initialMessages, profiles, currentUser }: Props) {
  const supabase = createClient()

  const [view,              setView]              = useState<CalView>('week')
  const [currentDate,       setCurrentDate]       = useState(new Date())
  const [tasks,             setTasks]             = useState<TaskWithLead[]>(initialTasks)
  const [messages,          setMessages]          = useState<ScheduledMsg[]>(initialMessages)
  const [filterResponsavel, setFilterResponsavel] = useState('')
  const [selectedTask,      setSelectedTask]      = useState<TaskWithLead | null>(null)
  const [selectedMsg,       setSelectedMsg]       = useState<ScheduledMsg | null>(null)
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
      .eq('unit_id', currentUser.unit_id)
      .not('data_limite', 'is', null)
      .eq('concluida', false)
      .order('data_limite')
    if (data) setTasks(data as TaskWithLead[])
  }

  async function reloadMessages() {
    const { data } = await supabase
      .from('wa_scheduled_messages')
      .select('id, conversation_id, content, type, template_name, scheduled_for, status, created_by, conversation:wa_conversations(wa_contact_name, lead:leads(nome, sobrenome))')
      .eq('unit_id', currentUser.unit_id)
      .neq('status', 'cancelled')
      .order('scheduled_for')
    if (data) setMessages(data as unknown as ScheduledMsg[])
  }

  const items: AgendaItem[] = [
    ...tasks
      .filter(t => !filterResponsavel || t.responsavel_id === filterResponsavel)
      .filter(t => t.data_limite)
      .map(t => ({ kind: 'task' as const, id: t.id, date: t.data_limite!, task: t })),
    ...messages
      .filter(m => !filterResponsavel || m.created_by === filterResponsavel)
      .map(m => ({ kind: 'message' as const, id: m.id, date: m.scheduled_for, message: m })),
  ]

  function itemsForDay(day: Date) {
    return items.filter(it => isSameDay(itemDate(it), day))
  }

  function handleItemClick(item: AgendaItem) {
    if (item.kind === 'task') setSelectedTask(item.task)
    else setSelectedMsg(item.message)
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
      <header className="bg-white flex items-center gap-3 shrink-0 flex-wrap" style={{ padding: '12px 20px', borderBottom: '1px solid #E9E5D8' }}>

        {/* View toggle */}
        <div className="flex items-center gap-1 shrink-0" style={{ background: '#F1EFE5', borderRadius: '999px', padding: '3px' }}>
          {(['day', 'week', 'month'] as CalView[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="transition-colors"
              style={{
                fontSize: '12px', fontWeight: v === view ? 800 : 700, padding: '6px 14px', borderRadius: '999px',
                background: v === view ? '#25402C' : 'transparent',
                color: v === view ? '#fff' : '#71856F',
                border: 'none', cursor: 'pointer',
              }}
            >
              {{ day: 'Dia', week: 'Semana', month: 'Mês' }[v]}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={prev}
            className="flex items-center justify-center transition-colors"
            style={{ width: 30, height: 30, borderRadius: 10, color: '#71856F', border: '1px solid #EBE7DA', background: '#fff', cursor: 'pointer' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => setCurrentDate(new Date())}
            className="transition-colors"
            style={{ fontSize: '12px', fontWeight: 800, padding: '6px 12px', borderRadius: 10, border: '1px solid #EBE7DA', color: '#71856F', background: '#fff', cursor: 'pointer' }}
          >
            Hoje
          </button>
          <button
            onClick={next}
            className="flex items-center justify-center transition-colors"
            style={{ width: 30, height: 30, borderRadius: 10, color: '#71856F', border: '1px solid #EBE7DA', background: '#fff', cursor: 'pointer' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Period title */}
        <span className="capitalize flex-1 min-w-0 truncate" style={{ fontSize: '14px', fontWeight: 800, color: '#25402C' }}>{headerTitle()}</span>

        {/* Responsável filter */}
        <select
          value={filterResponsavel}
          onChange={e => setFilterResponsavel(e.target.value)}
          className="focus:outline-none shrink-0"
          style={{ border: '1px solid #EBE7DA', borderRadius: '999px', padding: '6px 12px', fontSize: '12.5px', fontWeight: 700, color: '#71856F', background: '#fff', cursor: 'pointer' }}
        >
          <option value="">Todos responsáveis</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
        </select>

        {/* New task */}
        <button
          onClick={() => { setNewFormDate(null); setShowNewForm(true) }}
          className="flex items-center gap-1.5 shrink-0 transition-colors text-white"
          style={{ fontSize: '13px', fontWeight: 800, padding: '8px 16px', borderRadius: '999px', background: '#3E9849', boxShadow: '0 5px 14px -6px rgba(62,152,73,0.55)', border: 'none', cursor: 'pointer' }}
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
            itemsForDay={itemsForDay}
            onDayClick={d => { setCurrentDate(d); setView('day') }}
            onItemClick={handleItemClick}
            onNewTask={d => { setNewFormDate(d); setShowNewForm(true) }}
          />
        )}
        {(view === 'week' || view === 'day') && (
          <TimeGridView
            days={view === 'week' ? getWeekDays(currentDate) : [currentDate]}
            itemsForDay={itemsForDay}
            now={now}
            onItemClick={handleItemClick}
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

      {selectedMsg && (
        <ScheduledMessageModal
          msg={selectedMsg}
          onClose={() => setSelectedMsg(null)}
          onCancelled={() => { reloadMessages(); setSelectedMsg(null) }}
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
  itemsForDay,
  onDayClick,
  onItemClick,
  onNewTask,
}: {
  currentDate: Date
  itemsForDay: (d: Date) => AgendaItem[]
  onDayClick: (d: Date) => void
  onItemClick: (item: AgendaItem) => void
  onNewTask: (d: Date) => void
}) {
  const grid  = getMonthGrid(currentDate)
  const weeks = Math.ceil(grid.length / 7)

  return (
    <div className="h-full flex flex-col bg-white select-none">
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-[#EBE7DA] shrink-0">
        {WEEK_SHORT.map(d => (
          <div key={d} className="text-center text-[11px] font-semibold text-[#9AA79C] py-2 uppercase tracking-wide">
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
          const dayItems = itemsForDay(day)
          const inMonth  = isSameMonth(day, currentDate)
          const today    = isToday(day)

          return (
            <div
              key={day.toISOString()}
              className={`border-r border-b border-[#F4F1E7] p-1.5 flex flex-col gap-0.5 overflow-hidden group ${
                inMonth ? 'bg-white' : 'bg-[#FBFAF4]/60'
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
                  className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-[#9AA79C] hover:text-[#3E9849] hover:bg-[#E8F4E6] transition-all text-sm leading-none"
                >
                  +
                </button>
              </div>

              {dayItems.slice(0, 3).map(item => {
                const c = itemColor(item)
                return (
                  <button
                    key={item.id}
                    onClick={() => onItemClick(item)}
                    className="w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate font-medium border"
                    style={{ ...c.style, borderColor: c.barColor + '55' }}
                  >
                    <span className="opacity-70 mr-1">{format(itemDate(item), 'HH:mm')}</span>
                    {item.kind === 'message' && <span className="mr-0.5">💬</span>}
                    {itemTitle(item)}
                  </button>
                )
              })}

              {dayItems.length > 3 && (
                <button
                  onClick={() => onDayClick(day)}
                  className="text-[10px] text-[#9AA79C] hover:text-[#3E9849] text-left pl-1 transition-colors"
                >
                  +{dayItems.length - 3} mais
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
  itemsForDay,
  now,
  onItemClick,
  onSlotClick,
}: {
  days: Date[]
  itemsForDay: (d: Date) => AgendaItem[]
  now: Date
  onItemClick: (item: AgendaItem) => void
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
      <div className="flex border-b border-[#EBE7DA] shrink-0">
        <div className="w-14 shrink-0" />
        {days.map(day => (
          <div key={day.toISOString()} className="flex-1 text-center py-2 border-l border-[#F4F1E7]">
            <div className="text-[10px] uppercase font-semibold text-[#9AA79C] tracking-wide">
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
                className="absolute right-2 text-[10px] text-[#9AA79C]"
                style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT - 8}px` }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map(day => {
            const dayItems = itemsForDay(day)
            const showNow  = isToday(day) && nowTop >= 0 && nowTop <= TOTAL_H

            return (
              <div
                key={day.toISOString()}
                className="flex-1 relative border-l border-[#F4F1E7] cursor-crosshair"
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
                    className="absolute inset-x-0 border-t border-[#F4F1E7] pointer-events-none"
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
                      borderTop: '1px dashed #F4F1E7',
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
                {dayItems.map(item => {
                  const dt  = itemDate(item)
                  const top = taskTop(dt)
                  const c   = itemColor(item)
                  const done = item.kind === 'task' ? item.task.concluida : item.message.status === 'sent'
                  const subtitle = itemSubtitle(item)
                  return (
                    <div
                      key={item.id}
                      className="absolute left-1 right-1 rounded-lg px-2 py-1 cursor-pointer hover:z-10 hover:shadow-md transition-shadow"
                      style={{
                        ...c.style,
                        top: `${top}px`,
                        height: `${EVENT_H}px`,
                        borderLeft: `3px solid ${c.barColor}`,
                      }}
                      onClick={e => { e.stopPropagation(); onItemClick(item) }}
                    >
                      <p className={`text-[11px] font-semibold truncate ${done ? 'line-through opacity-60' : ''}`}>
                        {format(dt, 'HH:mm')} · {item.kind === 'message' && '💬 '}{itemTitle(item)}
                      </p>
                      {subtitle && (
                        <p className="text-[10px] truncate opacity-75 mt-0.5">{subtitle}</p>
                      )}
                      {item.kind === 'task' && item.task.responsavel && (
                        <p className="text-[10px] truncate opacity-60">
                          {displayName(item.task.responsavel)}
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
    <Drawer open={true} onClose={onClose} title={editing ? 'Editar tarefa' : 'Detalhes da tarefa'} width={420}
      footer={
        <div className="flex items-center gap-2 w-full">
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
                className="py-2 px-4 border border-[#EBE7DA] text-[#71856F] rounded-xl text-sm font-medium hover:bg-[#FBFAF4] transition-colors"
              >
                Cancelar
              </button>
            </>
          ) : confirm ? (
            <>
              <p className="text-xs text-[#71856F] flex-1">Excluir esta tarefa?</p>
              <button onClick={handleDelete} className="py-1.5 px-3 bg-red-500 text-white rounded-xl text-xs font-medium hover:bg-red-600 transition-colors">
                Confirmar
              </button>
              <button onClick={() => setConfirm(false)} className="py-1.5 px-3 border border-[#EBE7DA] text-[#71856F] rounded-xl text-xs hover:bg-[#FBFAF4] transition-colors">
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
                className="py-2 px-4 border border-[#EBE7DA] text-[#71856F] rounded-xl text-sm font-medium hover:bg-[#FBFAF4] transition-colors"
              >
                Editar
              </button>
              <button
                onClick={() => setConfirm(true)}
                className="py-2 px-3 text-[#9AA79C] hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                title="Excluir"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
      }
    >
      {/* Task info card */}
      <div className="flex items-start gap-3 mb-4">
        <div
          className={`w-3 h-3 rounded-full mt-1 shrink-0 ${
            task.concluida ? 'bg-[#3E9849]' : overdue ? 'bg-[#C05B3A]' : 'bg-[#1E86C0]'
          }`}
        />
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={form.titulo}
              onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
              className="w-full text-base font-semibold text-[#25402C] border-b border-[#CDE8CB] focus:outline-none pb-0.5 bg-transparent"
            />
          ) : (
            <h3 className={`text-base font-semibold text-[#25402C] ${task.concluida ? 'line-through text-[#9AA79C]' : ''}`}>
              {task.titulo}
            </h3>
          )}
          {task.lead && (
            <p className="text-xs text-[#71856F] mt-0.5">
              {task.lead.nome}{task.lead.sobrenome ? ` ${task.lead.sobrenome}` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {editing ? (
          <>
            <div>
              <label className="block text-xs font-medium text-[#71856F] mb-1">Data e hora</label>
              <DateTimePicker
                value={form.data_limite}
                onChange={v => setForm(f => ({ ...f, data_limite: v }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#71856F] mb-1">Responsável</label>
              <select
                value={form.responsavel_id}
                onChange={e => setForm(f => ({ ...f, responsavel_id: e.target.value }))}
                className="w-full rounded-xl border border-[#EBE7DA] px-3 py-2 text-sm focus:outline-none focus:ring-0 bg-white"
              >
                <option value="">Sem responsável</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#71856F] mb-1">Descrição</label>
              <textarea
                value={form.descricao}
                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                rows={2}
                placeholder="Detalhes adicionais..."
                className="w-full rounded-xl border border-[#EBE7DA] px-3 py-2 text-sm focus:outline-none focus:ring-0 resize-none"
              />
            </div>
          </>
        ) : (
          <>
            {task.data_limite && (
              <div className="flex items-center gap-2 text-sm text-[#35543B]">
                <svg className="w-4 h-4 text-[#9AA79C] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className={overdue ? 'text-red-600 font-medium' : ''}>
                  {format(parseISO(task.data_limite), "EEEE, d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                  {overdue && ' · Vencida'}
                </span>
              </div>
            )}
            {task.responsavel && (
              <div className="flex items-center gap-2 text-sm text-[#35543B]">
                <svg className="w-4 h-4 text-[#9AA79C] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {displayName(task.responsavel)}
              </div>
            )}
            {task.descricao && (
              <p className="text-sm text-[#71856F] bg-[#FBFAF4] rounded-xl px-3 py-2">{task.descricao}</p>
            )}
          </>
        )}
      </div>
    </Drawer>
  )
}

// ─── Scheduled message modal ─────────────────────────────────────────────────

function ScheduledMessageModal({
  msg,
  onClose,
  onCancelled,
}: {
  msg: ScheduledMsg
  onClose: () => void
  onCancelled: () => void
}) {
  const [cancelling, setCancelling] = useState(false)
  const [confirm,    setConfirm]    = useState(false)

  const contactName = msg.conversation?.lead
    ? `${msg.conversation.lead.nome}${msg.conversation.lead.sobrenome ? ` ${msg.conversation.lead.sobrenome}` : ''}`
    : msg.conversation?.wa_contact_name

  const statusLabel = { pending: 'Agendada', sent: 'Enviada', failed: 'Falhou' }[msg.status]
  const statusColor = { pending: 'text-violet-600', sent: 'text-emerald-600', failed: 'text-red-600' }[msg.status]

  async function handleCancel() {
    setCancelling(true)
    await fetch(`/api/whatsapp/schedule?id=${msg.id}`, { method: 'DELETE' })
    setCancelling(false)
    onCancelled()
  }

  return (
    <Drawer
      open={true}
      onClose={onClose}
      title={msg.type === 'template' ? `📋 ${msg.template_name}` : 'Mensagem agendada'}
      width={420}
      footer={msg.status === 'pending' ? (
        <div className="flex items-center gap-2 w-full">
          {confirm ? (
            <>
              <p className="text-xs text-[#71856F] flex-1">Cancelar este agendamento?</p>
              <button onClick={handleCancel} disabled={cancelling} className="py-1.5 px-3 bg-red-500 text-white rounded-xl text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-50">
                {cancelling ? 'Cancelando…' : 'Confirmar'}
              </button>
              <button onClick={() => setConfirm(false)} className="py-1.5 px-3 border border-[#EBE7DA] text-[#71856F] rounded-xl text-xs hover:bg-[#FBFAF4] transition-colors">
                Não
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirm(true)}
              className="flex-1 py-2 border border-red-200 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 transition-colors"
            >
              Cancelar agendamento
            </button>
          )}
        </div>
      ) : undefined}
    >
      {contactName && (
        <p className="text-sm text-[#71856F] mb-3">{contactName}</p>
      )}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-[#35543B]">
          <svg className="w-4 h-4 text-[#9AA79C] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {format(parseISO(msg.scheduled_for), "EEEE, d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
        </div>
        <p className={`text-xs font-semibold ${statusColor}`}>{statusLabel}</p>
        {msg.content && (
          <p className="text-sm text-[#71856F] bg-[#FBFAF4] rounded-xl px-3 py-2 whitespace-pre-wrap">{msg.content}</p>
        )}
      </div>
    </Drawer>
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
        .eq('unit_id', currentUser.unit_id)
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
    <Drawer
      open={true}
      onClose={onClose}
      title="Nova tarefa"
      width={420}
      footer={
        <>
          <button
            onClick={onClose}
            className="py-2 px-4 border border-[#EBE7DA] text-[#71856F] rounded-xl text-sm font-medium hover:bg-[#FBFAF4] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !form.titulo.trim() || !selectedLead}
            className="flex-1 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-40 transition-colors" style={{ background: 'var(--color-brand)' }}
          >
            {saving ? 'Criando…' : 'Criar tarefa'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-[#71856F] mb-1">Título *</label>
          <input
            autoFocus
            value={form.titulo}
            onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
            placeholder="Ex: Retorno vacina gripe"
            className="w-full rounded-xl border border-[#EBE7DA] px-3 py-2 text-sm focus:outline-none focus:ring-0"
          />
        </div>

        {/* Lead search */}
        <div className="relative">
          <label className="block text-xs font-medium text-[#71856F] mb-1">Contato *</label>
          <input
            value={leadQuery}
            onChange={e => handleLeadInput(e.target.value)}
            placeholder="Buscar por nome..."
            className="w-full rounded-xl border border-[#EBE7DA] px-3 py-2 text-sm focus:outline-none focus:ring-0"
          />
          {selectedLead && (
            <div className="absolute right-3 top-[34px] text-emerald-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          {showDropdown && leadResults.length > 0 && (
            <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white rounded-xl border border-[#EBE7DA] shadow-lg overflow-hidden">
              {leadResults.map(l => (
                <button
                  key={l.id}
                  onClick={() => selectLead(l)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#E8F4E6] transition-colors"
                >
                  {l.nome}{l.sobrenome ? ` ${l.sobrenome}` : ''}
                </button>
              ))}
            </div>
          )}
          {showDropdown && leadResults.length === 0 && leadQuery.length >= 2 && (
            <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white rounded-xl border border-[#EBE7DA] shadow-lg px-3 py-2 text-xs text-[#9AA79C]">
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
          <label className="block text-xs font-medium text-[#71856F] mb-1">Responsável</label>
          <select
            value={form.responsavel_id}
            onChange={e => setForm(f => ({ ...f, responsavel_id: e.target.value }))}
            className="w-full rounded-xl border border-[#EBE7DA] px-3 py-2 text-sm focus:outline-none focus:ring-0 bg-white"
          >
            {profiles.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
          </select>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-[#71856F] mb-1">Descrição (opcional)</label>
          <textarea
            value={form.descricao}
            onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
            rows={2}
            placeholder="Observações..."
            className="w-full rounded-xl border border-[#EBE7DA] px-3 py-2 text-sm focus:outline-none focus:ring-0 resize-none"
          />
        </div>
      </div>
    </Drawer>
  )
}
