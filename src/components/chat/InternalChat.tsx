'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/context/ProfileContext'
import type { Profile, InternalMessage } from '@/types/database'

interface ConvMessage extends InternalMessage {
  de?: Profile
}

function playChime() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start()
    osc.stop(ctx.currentTime + 0.4)
  } catch {}
}

export default function InternalChat() {
  const supabase = createClient()
  const { profile, loading } = useProfile()

  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConvMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [unreadByContact, setUnreadByContact] = useState<Record<string, number>>({})

  const bottomRef = useRef<HTMLDivElement>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Load other profiles
  useEffect(() => {
    if (!profile) return
    supabase
      .from('profiles')
      .select('*')
      .neq('id', profile.id)
      .order('full_name')
      .then(({ data }) => {
        if (data) setProfiles(data as Profile[])
      })
  }, [profile]) // eslint-disable-line

  // Fetch unread counts
  const fetchUnread = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('internal_messages')
      .select('de_id')
      .eq('para_id', profile.id)
      .eq('lido', false)
    if (!data) return
    const counts: Record<string, number> = {}
    for (const row of data) {
      counts[row.de_id] = (counts[row.de_id] ?? 0) + 1
    }
    setUnreadByContact(counts)
  }, [profile]) // eslint-disable-line

  useEffect(() => {
    fetchUnread()
  }, [fetchUnread])

  // Realtime subscription
  useEffect(() => {
    if (!profile) return

    const ch = supabase
      .channel(`internal_chat_${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'internal_messages',
          filter: `para_id=eq.${profile.id}`,
        },
        (payload) => {
          const msg = payload.new as InternalMessage
          playChime()
          // If this conversation is open, append directly
          if (msg.de_id === selectedId) {
            setMessages(prev => [...prev, msg])
            // mark read immediately
            supabase
              .from('internal_messages')
              .update({ lido: true })
              .eq('id', msg.id)
              .then(() => {})
          } else {
            setUnreadByContact(prev => ({
              ...prev,
              [msg.de_id]: (prev[msg.de_id] ?? 0) + 1,
            }))
          }
        }
      )
      .subscribe()

    channelRef.current = ch
    return () => {
      supabase.removeChannel(ch)
    }
  }, [profile, selectedId]) // eslint-disable-line

  // Load conversation when contact selected
  useEffect(() => {
    if (!profile || !selectedId) return
    setMessages([])

    supabase
      .from('internal_messages')
      .select('*')
      .or(
        `and(de_id.eq.${profile.id},para_id.eq.${selectedId}),and(de_id.eq.${selectedId},para_id.eq.${profile.id})`
      )
      .order('created_at')
      .then(({ data }) => {
        if (data) setMessages(data as ConvMessage[])
      })

    // Mark incoming as read
    supabase
      .from('internal_messages')
      .update({ lido: true })
      .eq('de_id', selectedId)
      .eq('para_id', profile.id)
      .eq('lido', false)
      .then(() => {
        setUnreadByContact(prev => ({ ...prev, [selectedId]: 0 }))
      })
  }, [selectedId]) // eslint-disable-line

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    if (!profile || !selectedId || !input.trim() || sending) return
    const text = input.trim()
    setInput('')
    setSending(true)
    const { data } = await supabase
      .from('internal_messages')
      .insert({ de_id: profile.id, para_id: selectedId, conteudo: text })
      .select()
      .single()
    if (data) setMessages(prev => [...prev, data as ConvMessage])
    setSending(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (loading || !profile) return null

  const totalUnread = Object.values(unreadByContact).reduce((a, b) => a + b, 0)
  const selectedProfile = profiles.find(p => p.id === selectedId)

  function formatTime(iso: string) {
    const d = new Date(iso)
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }

  function initial(name: string) {
    return name ? name[0].toUpperCase() : '?'
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-4 right-4 z-[89] w-12 h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
        title="Chat interno"
      >
        {open ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
            </svg>
            {totalUnread > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {totalUnread > 9 ? '9+' : totalUnread}
              </span>
            )}
          </>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-4 z-[89] w-80 h-[480px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-indigo-600 text-white px-4 py-3 flex items-center gap-2 shrink-0">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
            </svg>
            <span className="text-sm font-semibold flex-1 truncate">
              {selectedId && selectedProfile ? selectedProfile.full_name : 'Chat Interno'}
            </span>
            {selectedId && (
              <button
                onClick={() => setSelectedId(null)}
                className="text-indigo-200 hover:text-white transition-colors"
                title="Voltar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
          </div>

          {!selectedId ? (
            /* Contact list */
            <div className="flex-1 overflow-y-auto">
              {profiles.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-gray-400 px-4 text-center">
                  Nenhum outro usuário cadastrado.
                </div>
              ) : (
                profiles.map(p => {
                  const unread = unreadByContact[p.id] ?? 0
                  const isGestor = p.role === 'gestor'
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-100 last:border-0"
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold ${
                        isGestor ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'
                      }`}>
                        {initial(p.full_name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{p.full_name}</div>
                        <div className={`text-[11px] font-medium ${isGestor ? 'text-purple-500' : 'text-emerald-500'}`}>
                          {isGestor ? 'Gestor' : 'Operador'}
                        </div>
                      </div>
                      {unread > 0 && (
                        <span className="bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1">
                          {unread > 9 ? '9+' : unread}
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          ) : (
            /* Conversation */
            <>
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                {messages.length === 0 && (
                  <div className="text-center text-xs text-gray-400 mt-8">
                    Nenhuma mensagem ainda. Diga olá!
                  </div>
                )}
                {messages.map(msg => {
                  const isMe = msg.de_id === profile.id
                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[72%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                        isMe
                          ? 'bg-indigo-600 text-white rounded-br-sm'
                          : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                      }`}>
                        <p className="break-words leading-snug">{msg.conteudo}</p>
                        <span className={`text-[10px] mt-0.5 block text-right ${
                          isMe ? 'text-indigo-200' : 'text-gray-400'
                        }`}>
                          {formatTime(msg.created_at)}
                        </span>
                      </div>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="border-t border-gray-200 p-2 flex gap-2 items-end shrink-0">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Mensagem..."
                  rows={1}
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                  style={{ minHeight: '38px', maxHeight: '96px' }}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="w-9 h-9 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
