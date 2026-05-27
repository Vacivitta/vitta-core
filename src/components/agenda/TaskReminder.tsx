'use client'

import { useState, useEffect, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import type { LeadTask } from '@/types/database'

interface ReminderTask extends LeadTask {
  lead?: { id: string; nome: string; sobrenome: string | null } | null
}

function playChime() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx  = new AudioCtx()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = 660
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.8)
  } catch {
    // AudioContext not available (e.g. server-side or sandboxed)
  }
}

export default function TaskReminder() {
  const supabase   = createClient()
  const [alerts, setAlerts] = useState<ReminderTask[]>([])
  const dismissed  = useRef<Set<string>>(new Set())
  const snoozed    = useRef<Map<string, number>>(new Map())

  async function checkTasks() {
    const now  = new Date()
    const in15 = new Date(now.getTime() + 15 * 60 * 1000)

    const { data } = await supabase
      .from('lead_tasks')
      .select('*, lead:leads(id, nome, sobrenome)')
      .eq('concluida', false)
      .not('data_limite', 'is', null)
      .gte('data_limite', now.toISOString())
      .lte('data_limite', in15.toISOString())

    if (!data) return

    const incoming = (data as ReminderTask[]).filter(t => {
      if (dismissed.current.has(t.id)) return false
      const snoozeUntil = snoozed.current.get(t.id)
      if (snoozeUntil && Date.now() < snoozeUntil) return false
      return true
    })

    setAlerts(prev => {
      const existingIds = new Set(prev.map(t => t.id))
      const toAdd       = incoming.filter(t => !existingIds.has(t.id))
      if (toAdd.length > 0) playChime()
      return [
        ...prev.filter(t => !dismissed.current.has(t.id) && (snoozed.current.get(t.id) ?? 0) <= Date.now()),
        ...toAdd,
      ]
    })
  }

  useEffect(() => {
    checkTasks()
    const id = setInterval(checkTasks, 60_000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function dismiss(id: string) {
    dismissed.current.add(id)
    setAlerts(prev => prev.filter(t => t.id !== id))
  }

  function snooze(id: string) {
    snoozed.current.set(id, Date.now() + 10 * 60 * 1000)
    setAlerts(prev => prev.filter(t => t.id !== id))
  }

  async function complete(task: ReminderTask) {
    await supabase.from('lead_tasks').update({ concluida: true }).eq('id', task.id)
    dismiss(task.id)
  }

  if (alerts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
      {alerts.map(task => (
        <div
          key={task.id}
          className="bg-white border border-amber-200 shadow-xl rounded-2xl p-4 pointer-events-auto"
          style={{ animation: 'slideInRight 0.25s ease-out' }}
        >
          <div className="flex items-start gap-3">
            {/* Bell */}
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{task.titulo}</p>
              {task.lead && (
                <p className="text-xs text-gray-500 truncate">
                  {task.lead.nome}{task.lead.sobrenome ? ` ${task.lead.sobrenome}` : ''}
                </p>
              )}
              {task.data_limite && (
                <p className="text-xs text-amber-600 font-medium mt-0.5">
                  {format(parseISO(task.data_limite), "HH:mm · d 'de' MMM", { locale: ptBR })}
                </p>
              )}
            </div>

            {/* Dismiss */}
            <button
              onClick={() => dismiss(task.id)}
              className="text-gray-400 hover:text-gray-600 p-0.5 rounded transition-colors shrink-0"
              title="Dispensar"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => complete(task)}
              className="flex-1 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
            >
              Concluir
            </button>
            <button
              onClick={() => snooze(task.id)}
              className="flex-1 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Adiar 10 min
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
