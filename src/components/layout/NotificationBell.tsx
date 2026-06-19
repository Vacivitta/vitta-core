'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/context/ProfileContext'
import type { Notification } from '@/types/database'

const fmtTime = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60)    return 'agora'
  if (diff < 3600)  return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

interface Toast {
  id:    string
  title: string
  body:  string | null
}

export default function NotificationBell() {
  const { profile } = useProfile()
  const supabase    = createClient()

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open,          setOpen]          = useState(false)
  const [toasts,        setToasts]        = useState<Toast[]>([])
  const [dropdownPos,   setDropdownPos]   = useState({ left: 0, bottom: 0, width: 0 })
  const dropdownRef = useRef<HTMLDivElement>(null)

  const unread = notifications.filter(n => !n.lida).length

  // ── Carregar notificações ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('criado_em', { ascending: false })
      .limit(30)
    if (data) setNotifications(data as Notification[])
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  // ── Realtime: escutar novos INSERTs ───────────────────────────────────────
  useEffect(() => {
    if (!profile) return

    const channel = supabase
      .channel('notifications-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const n = payload.new as Notification
          // Verificar se é para este usuário ou para toda a unidade
          const isOwn  = n.user_id === profile.id
          const isUnit = n.user_id === null && n.unit_id === profile.unit_id
          if (!isOwn && !isUnit) return

          setNotifications(prev => [n, ...prev])
          setToasts(prev => [...prev, { id: n.id, title: n.title, body: n.body }])
          setTimeout(() => setToasts(prev => prev.filter(t => t.id !== n.id)), 5000)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fechar dropdown ao clicar fora ────────────────────────────────────────
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  // ── Marcar como lida ──────────────────────────────────────────────────────
  async function markRead(id: string) {
    await supabase.from('notifications').update({ lida: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, lida: true } : n))
  }

  async function markAllRead() {
    const ids = notifications.filter(n => !n.lida).map(n => n.id)
    if (ids.length === 0) return
    await supabase.from('notifications').update({ lida: true }).in('id', ids)
    setNotifications(prev => prev.map(n => ({ ...n, lida: true })))
  }

  if (!profile) return null

  return (
    <>
      {/* ── Sino ──────────────────────────────────────────────────────────── */}
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => {
            if (!open && dropdownRef.current) {
              const rect = dropdownRef.current.getBoundingClientRect()
              setDropdownPos({ left: rect.left, bottom: window.innerHeight - rect.top + 4, width: Math.max(rect.width, 320) })
            }
            setOpen(v => !v)
          }}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
            padding: '11px 13px', borderRadius: '12px', border: 'none', cursor: 'pointer',
            fontSize: '14px', fontWeight: 600, textAlign: 'left',
            transition: 'background 0.15s, color 0.15s',
            background: open ? '#EAF6FC' : 'transparent',
            color:      open ? '#0098DA'  : '#3F5666',
          }}
          className={!open ? 'nav-item-idle' : ''}
        >
          <div style={{ position: 'relative', flexShrink: 0, display: 'flex' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unread > 0 && (
              <span style={{
                position: 'absolute', top: '-4px', right: '-4px',
                minWidth: '14px', height: '14px',
                background: '#E5484D', color: '#fff',
                fontSize: '9px', fontWeight: 800, borderRadius: '999px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 2px', lineHeight: 1,
              }}>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </div>
          <span style={{ flex: 1 }}>Notificações</span>
        </button>

        {/* ── Dropdown ──────────────────────────────────────────────────── */}
        {open && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden" style={{ position: 'fixed', left: dropdownPos.left, bottom: dropdownPos.bottom, width: '320px', zIndex: 200 }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-900">Notificações</span>
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs font-medium"
                  style={{ color: 'var(--color-brand)' }}
                >
                  Marcar todas como lidas
                </button>
              )}
            </div>

            {/* Lista */}
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
              {notifications.length === 0 && (
                <div className="py-10 text-center">
                  <p className="text-sm text-gray-400">Nenhuma notificação</p>
                </div>
              )}
              {notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className="w-full text-left flex items-start gap-3 px-4 py-3 transition-colors"
                  style={{ background: !n.lida ? 'var(--color-brand-subtle)' : undefined }}
                >
                  <div
                    className="mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-sm"
                    style={{ background: n.type === 'quote_aceito' ? 'var(--color-success-subtle)' : n.type === 'quote_recusado' ? 'var(--color-danger-subtle)' : 'var(--color-track)' }}
                  >
                    {n.type === 'quote_aceito' ? (
                      <svg width="14" height="14" fill="none" stroke="var(--color-success)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                    ) : n.type === 'quote_recusado' ? (
                      <svg width="14" height="14" fill="none" stroke="var(--color-danger)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                    ) : (
                      <svg width="14" height="14" fill="none" stroke="var(--color-muted)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!n.lida ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{n.body}</p>
                    )}
                    <p className="text-[11px] text-gray-400 mt-1">{fmtTime(n.criado_em)}</p>
                  </div>
                  {!n.lida && (
                    <div className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: 'var(--color-brand)' }} />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Toasts ────────────────────────────────────────────────────────── */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className="pointer-events-auto bg-white border border-gray-200 rounded-2xl shadow-xl px-4 py-3 flex items-start gap-3 w-72 animate-slide-up"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{t.title}</p>
              {t.body && <p className="text-xs text-gray-500 mt-0.5 truncate">{t.body}</p>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
