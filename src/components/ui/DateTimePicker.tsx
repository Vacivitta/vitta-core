'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  format, startOfMonth, endOfMonth, startOfWeek,
  addDays, addMonths, subMonths, isSameDay, isSameMonth,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ── Utils ─────────────────────────────────────────────────────────────────────

// Parseia "YYYY-MM-DDTHH:mm" como hora LOCAL (sem ambiguidade de timezone)
function parseLocalStr(s: string): Date {
  const [date, time] = s.split('T')
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi]    = time.split(':').map(Number)
  return new Date(y, mo - 1, d, h, mi, 0, 0)
}

function buildLocalStr(date: Date, h: number, mi: number): string {
  return (
    format(date, 'yyyy-MM-dd') +
    'T' +
    String(h).padStart(2, '0') +
    ':' +
    String(mi).padStart(2, '0')
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  value:        string              // "YYYY-MM-DDTHH:mm" hora local, ou ""
  onChange:     (v: string) => void // chamado ao confirmar
  placeholder?: string
  minNow?:      boolean             // desabilita datas/horas no passado
  label?:       string
  style?:       React.CSSProperties
}

export default function DateTimePicker({
  value, onChange, placeholder = 'Selecionar data e hora',
  minNow = false, label, style,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [open,       setOpen]      = useState(false)
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 })
  const [mounted,    setMounted]   = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // Estado interno do picker
  const initial = value ? parseLocalStr(value) : null
  const [view,     setView]   = useState<Date>(() => initial ?? new Date())
  const [selDate,  setSelDate] = useState<Date | null>(initial)
  const [hour,     setHour]   = useState<number>(initial?.getHours()   ?? 9)
  const [minute,   setMinute] = useState<number>(initial?.getMinutes() ?? 0)

  // Sincroniza se value mudar externamente
  useEffect(() => {
    if (value) {
      const p = parseLocalStr(value)
      setSelDate(p); setView(p); setHour(p.getHours()); setMinute(p.getMinutes())
    } else {
      setSelDate(null)
    }
  }, [value])

  function openPicker() {
    if (triggerRef.current) {
      const rect      = triggerRef.current.getBoundingClientRect()
      const popH      = 440  // altura aproximada do popover
      const popW      = 280
      const viewH     = window.innerHeight
      const viewW     = window.innerWidth
      const MARGIN    = 8

      // Abre abaixo; se não couber, abre acima
      let top  = rect.bottom + MARGIN
      if (top + popH > viewH) top = Math.max(MARGIN, rect.top - popH - MARGIN)

      // Alinhado à esquerda do trigger; se ultrapassar a direita, empurra para dentro
      let left = rect.left
      if (left + popW > viewW - MARGIN) left = Math.max(MARGIN, viewW - popW - MARGIN)

      setPopoverPos({ top, left })
    }
    setOpen(v => !v)
  }

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (
        popoverRef.current && !popoverRef.current.contains(t) &&
        triggerRef.current && !triggerRef.current.contains(t)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Grade do calendário
  const monthStart = startOfMonth(view)
  const monthEnd   = endOfMonth(view)
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 0 })
  const days: Date[] = []
  let cur = gridStart
  while (cur <= monthEnd || days.length % 7 !== 0) {
    days.push(cur)
    cur = addDays(cur, 1)
    if (days.length >= 42) break
  }

  const now      = new Date()
  const today    = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const minDate  = minNow ? today : null

  function isDisabled(day: Date) {
    return !!(minDate && day < minDate)
  }

  function handleConfirm() {
    if (!selDate) return
    onChange(buildLocalStr(selDate, hour, minute))
    setOpen(false)
  }

  function handleClear() {
    onChange('')
    setSelDate(null)
    setOpen(false)
  }

  const displayLabel = value
    ? format(parseLocalStr(value), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })
    : ''

  const popover = open ? (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: popoverPos.top,
        left: popoverPos.left,
        zIndex: 9999,
        background: '#fff', borderRadius: 16,
        boxShadow: '0 12px 40px rgba(14,44,61,0.18), 0 2px 8px rgba(14,44,61,0.08)',
        border: '1px solid #E8EDF2', padding: '16px', width: 280,
      }}
    >
      {/* Navegação do mês */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button type="button" onClick={() => setView(d => subMonths(d, 1))} style={navBtn}>
          <svg width="13" height="13" fill="none" stroke="#5A7184" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#0E2C3D', textTransform: 'capitalize' }}>
          {format(view, "MMMM 'de' yyyy", { locale: ptBR })}
        </span>
        <button type="button" onClick={() => setView(d => addMonths(d, 1))} style={navBtn}>
          <svg width="13" height="13" fill="none" stroke="#5A7184" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Cabeçalho dias */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
        {['D','S','T','Q','Q','S','S'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#B0BEC9', padding: '2px 0' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Grade de dias */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {days.map((day, i) => {
          const sel      = selDate && isSameDay(day, selDate)
          const curMonth = isSameMonth(day, view)
          const isToday  = isSameDay(day, today)
          const disabled = isDisabled(day)
          return (
            <button
              key={i}
              type="button"
              onClick={() => !disabled && setSelDate(day)}
              disabled={disabled}
              style={{
                width: 34, height: 34, borderRadius: 9, border: 'none',
                background: sel ? '#0098DA' : isToday && !sel ? '#E8F5FD' : 'transparent',
                color: sel ? '#fff' : !curMonth ? '#D1D9E0' : isToday ? '#0098DA' : '#0E2C3D',
                fontSize: 12, fontWeight: sel || isToday ? 700 : 400,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.3 : 1,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!sel && !disabled && curMonth) (e.currentTarget as HTMLElement).style.background = '#F1F4F7' }}
              onMouseLeave={e => { if (!sel && !disabled) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>

      {/* Seletor de hora */}
      <div style={{ borderTop: '1px solid #F1F4F7', marginTop: 14, paddingTop: 14 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#8FA0AF', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Horário</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TimeSpinner value={hour} min={0} max={23} onChange={setHour} label="h" />
          <span style={{ fontSize: 18, fontWeight: 700, color: '#0E2C3D', lineHeight: 1 }}>:</span>
          <TimeSpinner value={minute} min={0} max={55} step={5} onChange={setMinute} label="min" />
        </div>
      </div>

      {/* Botões */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" onClick={handleClear}
          style={{ flex: 1, padding: '8px', fontSize: 12, fontWeight: 600, border: '1px solid #E8EDF2', borderRadius: 9, cursor: 'pointer', background: '#fff', color: '#5A7184' }}>
          Limpar
        </button>
        <button type="button" onClick={handleConfirm} disabled={!selDate}
          style={{ flex: 2, padding: '8px', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 9, cursor: selDate ? 'pointer' : 'default', background: selDate ? '#0098DA' : '#E8EDF2', color: selDate ? '#fff' : '#B0BEC9' }}>
          Confirmar
        </button>
      </div>
    </div>
  ) : null

  return (
    <div style={{ position: 'relative', ...style }}>
      {label && (
        <p style={{ fontSize: 12, fontWeight: 700, color: '#5A7184', marginBottom: 6, marginTop: 0 }}>
          {label}
        </p>
      )}

      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={openPicker}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 12px', border: `1px solid ${open ? '#0098DA' : '#E8EDF2'}`,
          borderRadius: 11, background: '#fff', cursor: 'pointer', gap: 8,
          boxShadow: open ? '0 0 0 3px rgba(0,152,218,0.12)' : 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        <span style={{ fontSize: 13, color: displayLabel ? '#0E2C3D' : '#B0BEC9' }}>
          {displayLabel || placeholder}
        </span>
        <svg width="15" height="15" fill="none" stroke={open ? '#0098DA' : '#8FA0AF'} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>

      {/* Popover via portal — escapa de qualquer overflow:hidden pai */}
      {mounted && popover && createPortal(popover, document.body)}
    </div>
  )
}

// ── TimeSpinner ───────────────────────────────────────────────────────────────

function TimeSpinner({ value, min, max, step = 1, onChange, label }: {
  value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; label: string
}) {
  function inc() { onChange(value + step > max ? min : value + step) }
  function dec() { onChange(value - step < min ? max : value - step) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <button type="button" onClick={inc} style={spinBtn}>
        <svg width="12" height="12" fill="none" stroke="#5A7184" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
        </svg>
      </button>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0E2C3D', lineHeight: 1, fontVariantNumeric: 'tabular-nums', minWidth: 36 }}>
          {String(value).padStart(2, '0')}
        </div>
        <div style={{ fontSize: 10, color: '#B0BEC9', fontWeight: 600 }}>{label}</div>
      </div>
      <button type="button" onClick={dec} style={spinBtn}>
        <svg width="12" height="12" fill="none" stroke="#5A7184" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  )
}

// ── Styles compartilhados ─────────────────────────────────────────────────────

const navBtn: React.CSSProperties = {
  background: '#F1F4F7', border: 'none', borderRadius: 8,
  width: 30, height: 30, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const spinBtn: React.CSSProperties = {
  background: '#F1F4F7', border: 'none', borderRadius: 7,
  width: 28, height: 24, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
