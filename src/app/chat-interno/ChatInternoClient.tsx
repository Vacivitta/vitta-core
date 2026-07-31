'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile, InternalChannel, InternalChannelMessage, Unit } from '@/types/database'
import { displayName } from '@/types/database'

type MiniProfile = Pick<Profile, 'id' | 'full_name' | 'apelido'>

interface Props {
  channels: InternalChannel[]
  currentUser: Profile
  unitProfiles: MiniProfile[]
}

function otherUnit(ch: InternalChannel, myUnitId: string): Unit | undefined {
  return ch.unit_a_id === myUnitId ? ch.unit_b : ch.unit_a
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatInternoClient({ channels, currentUser, unitProfiles }: Props) {
  const supabase = createClient()
  const unitId = currentUser.unit_id!

  const [activeChannel, setActiveChannel] = useState<InternalChannel | null>(channels[0] ?? null)
  const [messages, setMessages] = useState<InternalChannelMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [showMentionPicker, setShowMentionPicker] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const mentionPickerRef = useRef<HTMLDivElement>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number } | null>(null)

  const mentionableProfiles = unitProfiles.filter(p => p.id !== currentUser.id)
  const filteredPickerProfiles = mentionFilter
    ? mentionableProfiles.filter(p => displayName(p as Profile).toLowerCase().includes(mentionFilter.toLowerCase()) || p.full_name.toLowerCase().includes(mentionFilter.toLowerCase())).slice(0, 8)
    : mentionableProfiles.slice(0, 8)

  const mentionCandidates = mentionQuery !== null
    ? mentionableProfiles.filter(p => displayName(p as Profile).toLowerCase().includes(mentionQuery.toLowerCase()) || p.full_name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
    : []

  function handleTextChange(val: string, cursorPos?: number) {
    setText(val)
    const cursor = cursorPos ?? inputRef.current?.selectionStart ?? val.length
    const before = val.slice(0, cursor)
    const atMatch = before.match(/@([^\s@]*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1])
      setMentionStart(cursor - atMatch[0].length)
      setMentionIdx(0)
      if (inputRef.current) {
        const rect = inputRef.current.getBoundingClientRect()
        setMentionPos({ top: rect.top - 4, left: rect.left })
      }
    } else {
      setMentionQuery(null)
    }
  }

  function insertMention(p: MiniProfile) {
    const name = displayName(p as Profile)
    const before = text.slice(0, mentionStart)
    const after = text.slice(inputRef.current?.selectionStart ?? mentionStart)
    const newText = before + '@' + name + ' ' + after
    setText(newText)
    setMentionQuery(null)
    requestAnimationFrame(() => {
      const pos = mentionStart + name.length + 2
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  function insertMentionFromPicker(p: MiniProfile) {
    const name = displayName(p as Profile)
    const textarea = inputRef.current
    const cursorPos = textarea?.selectionStart ?? text.length
    const before = text.slice(0, cursorPos)
    const after = text.slice(cursorPos)
    const needsSpace = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n')
    const newText = before + (needsSpace ? ' ' : '') + '@' + name + ' ' + after
    setText(newText)
    setShowMentionPicker(false)
    setMentionFilter('')
    requestAnimationFrame(() => {
      const pos = cursorPos + (needsSpace ? 1 : 0) + name.length + 2
      textarea?.focus()
      textarea?.setSelectionRange(pos, pos)
    })
  }

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const loadMessages = useCallback(async (channelId: string) => {
    setLoading(true)
    const res = await fetch(`/api/internal-chat?channel_id=${channelId}`)
    if (res.ok) {
      const data = await res.json()
      setMessages(data.messages ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (activeChannel) loadMessages(activeChannel.id)
  }, [activeChannel, loadMessages])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (!activeChannel) return
    const channel = supabase
      .channel(`icm-${activeChannel.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'internal_channel_messages',
          filter: `channel_id=eq.${activeChannel.id}`,
        },
        (payload) => {
          const msg = payload.new as InternalChannelMessage
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev
            return [...prev, msg]
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [activeChannel]) // eslint-disable-line react-hooks/exhaustive-deps

  function clearPending() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(null)
    setPendingPreview(null)
  }

  function handleFileSelect(file: File) {
    setPendingFile(file)
    setPendingPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null)
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) return
        const file = new File([blob], `paste-${Date.now()}.png`, { type: blob.type })
        handleFileSelect(file)
        return
      }
    }
  }

  async function handleSend() {
    if ((!text.trim() && !pendingFile) || !activeChannel || sending) return
    setSending(true)

    const mencoes: string[] = []
    for (const p of unitProfiles) {
      if (p.id !== currentUser.id && text.includes('@' + displayName(p as Profile))) mencoes.push(p.id)
    }

    let res: Response
    if (pendingFile) {
      const form = new FormData()
      form.append('channel_id', activeChannel.id)
      form.append('file', pendingFile)
      if (text.trim()) form.append('conteudo', text.trim())
      if (mencoes.length > 0) form.append('mencoes', JSON.stringify(mencoes))
      res = await fetch('/api/internal-chat', { method: 'POST', body: form })
    } else {
      res = await fetch('/api/internal-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: activeChannel.id, conteudo: text.trim(), mencoes }),
      })
    }

    if (res.ok) {
      const msg = await res.json() as InternalChannelMessage
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
      setText('')
      clearPending()
      inputRef.current?.focus()
    }
    setSending(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(i + 1, mentionCandidates.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionCandidates[mentionIdx]); return }
      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const authorName = (msg: InternalChannelMessage) => {
    if (msg.autor_id === currentUser.id) return 'Você'
    if (msg.autor) return displayName(msg.autor as Pick<Profile, 'full_name' | 'apelido'>)
    const p = unitProfiles.find(u => u.id === msg.autor_id)
    return p ? displayName(p) : 'Usuário'
  }

  return (
    <div style={{ display: 'flex', height: '100%', background: '#FBFAF4' }}>
      {/* Channel list */}
      <div style={{
        width: 280, flexShrink: 0, borderRight: '1px solid #EBE7DA',
        display: 'flex', flexDirection: 'column', background: '#fff',
      }}>
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #EBE7DA' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#25402C', margin: 0 }}>Chat Interno</h2>
          <p style={{ fontSize: 12, color: '#9AA79C', marginTop: 4 }}>Conversas entre unidades</p>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {channels.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: '#9AA79C' }}>Nenhum canal disponível</p>
              <p style={{ fontSize: 12, color: '#B5B0A1', marginTop: 4 }}>Peça a um admin para criar canais entre unidades.</p>
            </div>
          )}
          {channels.map(ch => {
            const other = otherUnit(ch, unitId)
            const isActive = activeChannel?.id === ch.id
            return (
              <button
                key={ch.id}
                onClick={() => setActiveChannel(ch)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '12px 16px', border: 'none',
                  background: isActive ? '#E8F4E6' : 'transparent',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: isActive ? '#3E9849' : '#EBE7DA',
                  color: isActive ? '#fff' : '#71856F',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, flexShrink: 0,
                }}>
                  {other?.nome?.charAt(0)?.toUpperCase() ?? '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    fontSize: 13, fontWeight: isActive ? 700 : 600,
                    color: isActive ? '#25402C' : '#4A6B4F',
                    margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {other?.nome ?? 'Unidade'}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Chat panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {activeChannel ? (
          <>
            {/* Header */}
            <div style={{
              padding: '14px 20px', borderBottom: '1px solid #EBE7DA',
              display: 'flex', alignItems: 'center', gap: 10, background: '#fff',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: '#3E9849', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
              }}>
                {otherUnit(activeChannel, unitId)?.nome?.charAt(0)?.toUpperCase() ?? '?'}
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#25402C', margin: 0 }}>
                  {otherUnit(activeChannel, unitId)?.nome ?? 'Unidade'}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: '20px 24px',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              {loading && (
                <div style={{ textAlign: 'center', padding: 20 }}>
                  <p style={{ fontSize: 13, color: '#9AA79C' }}>Carregando...</p>
                </div>
              )}
              {!loading && messages.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <p style={{ fontSize: 13, color: '#9AA79C' }}>Nenhuma mensagem ainda</p>
                  <p style={{ fontSize: 12, color: '#B5B0A1', marginTop: 4 }}>Envie a primeira mensagem para iniciar a conversa.</p>
                </div>
              )}
              {messages.map(msg => {
                const isMine = msg.autor_id === currentUser.id
                return (
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      justifyContent: isMine ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div style={{
                      maxWidth: '70%', padding: '8px 14px',
                      borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      background: isMine ? '#3E9849' : '#fff',
                      color: isMine ? '#fff' : '#25402C',
                      border: isMine ? 'none' : '1px solid #EBE7DA',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: isMine ? 'rgba(255,255,255,0.8)' : '#3E9849', margin: '0 0 2px' }}>
                        {authorName(msg)}
                      </p>
                      {msg.media_url && msg.media_type?.startsWith('image/') && (
                        <img src={msg.media_url} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginBottom: msg.conteudo ? 6 : 0, cursor: 'pointer' }} onClick={() => window.open(msg.media_url!, '_blank')} />
                      )}
                      {msg.media_url && !msg.media_type?.startsWith('image/') && (
                        <a href={msg.media_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: isMine ? '#d4f0ff' : '#1E86C0', textDecoration: 'underline', marginBottom: msg.conteudo ? 4 : 0 }}>
                          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                          Arquivo
                        </a>
                      )}
                      {msg.conteudo && (
                        <p style={{ fontSize: 13.5, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
                          {msg.conteudo.split(/(@\S+)/g).map((part, pi) =>
                            part.startsWith('@') ? <span key={pi} style={{ color: isMine ? '#d4f0ff' : '#1E86C0', fontWeight: 600 }}>{part}</span> : part
                          )}
                        </p>
                      )}
                      <p style={{
                        fontSize: 10, margin: '4px 0 0',
                        color: isMine ? 'rgba(255,255,255,0.65)' : '#9AA79C',
                        textAlign: 'right',
                      }}>
                        {fmtTime(msg.created_at)}
                      </p>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {/* Pending file preview */}
            {pendingFile && (
              <div style={{ padding: '8px 20px 0', borderTop: '1px solid #EBE7DA', background: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
                {pendingPreview ? (
                  <img src={pendingPreview} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8, border: '1px solid #EBE7DA' }} />
                ) : (
                  <div style={{ width: 60, height: 60, borderRadius: 8, background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="20" height="20" fill="none" stroke="#9AA79C" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#25402C', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingFile.name}</p>
                  <p style={{ fontSize: 11, color: '#9AA79C', margin: '2px 0 0' }}>{(pendingFile.size / 1024).toFixed(0)} KB</p>
                </div>
                <button onClick={clearPending} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: '#9AA79C' }}>
                  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}

            {/* Input */}
            <div style={{
              padding: '12px 20px', borderTop: pendingFile ? 'none' : '1px solid #EBE7DA',
              display: 'flex', gap: 8, alignItems: 'flex-end', background: '#fff', position: 'relative',
            }}>
              {/* Mention picker dropdown */}
              {showMentionPicker && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowMentionPicker(false)} />
                  <div ref={mentionPickerRef} style={{ position: 'absolute', bottom: '100%', left: 20, marginBottom: 4, background: '#fff', border: '1px solid #EBE7DA', borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 50, width: 280, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 10px', borderBottom: '1px solid #F3F4F6' }}>
                      <input
                        autoFocus
                        value={mentionFilter}
                        onChange={e => setMentionFilter(e.target.value)}
                        placeholder="Buscar usuário..."
                        style={{ width: '100%', border: '1px solid #EBE7DA', borderRadius: 8, padding: '6px 10px', fontSize: 12, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {filteredPickerProfiles.length === 0 && (
                        <p style={{ fontSize: 12, color: '#9AA79C', textAlign: 'center', padding: '12px 0' }}>Nenhum usuário encontrado</p>
                      )}
                      {filteredPickerProfiles.map(p => (
                        <button key={p.id} onClick={() => insertMentionFromPicker(p)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#E8F4E6')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#3E9849', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                            {(p.full_name ?? '?')[0].toUpperCase()}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#25402C', display: 'block' }}>{displayName(p as Profile)}</span>
                            {p.apelido && <span style={{ fontSize: 10, color: '#9AA79C' }}>{p.full_name}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <input ref={fileInputRef} type="file" accept="image/*,video/*,application/pdf" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = '' }} />
              <button onClick={() => fileInputRef.current?.click()} title="Anexar arquivo" style={{ width: 40, height: 40, borderRadius: 12, border: '1px solid #EBE7DA', background: '#FBFAF4', color: '#71856F', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
              </button>
              <button onClick={() => { setShowMentionPicker(v => !v); setMentionFilter('') }} title="Mencionar usuário" style={{ width: 40, height: 40, borderRadius: 12, border: showMentionPicker ? '1px solid #3E9849' : '1px solid #EBE7DA', background: showMentionPicker ? '#E8F4E6' : '#FBFAF4', color: showMentionPicker ? '#3E9849' : '#71856F', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16, fontWeight: 700 }}>
                @
              </button>
              <textarea
                ref={inputRef}
                value={text}
                onChange={e => handleTextChange(e.target.value, e.target.selectionStart ?? undefined)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
                placeholder="Digite sua mensagem..."
                rows={1}
                style={{
                  flex: 1, resize: 'none', border: '1px solid #EBE7DA',
                  borderRadius: 12, padding: '10px 14px', fontSize: 13.5,
                  outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
                  maxHeight: 120, overflowY: 'auto',
                }}
              />
              {/* Keyboard @ inline popup */}
              {mentionQuery !== null && mentionCandidates.length > 0 && (
                <div style={{ position: 'absolute', bottom: '100%', left: 20, marginBottom: 4, background: '#fff', border: '1px solid #EBE7DA', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 220, maxWidth: 320, overflow: 'hidden' }}>
                  {mentionCandidates.map((p, i) => (
                    <button key={p.id} onMouseDown={e => { e.preventDefault(); insertMention(p) }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: 'none', background: i === mentionIdx ? '#E8F4E6' : 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#3E9849', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                        {(p.full_name ?? '?')[0].toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#25402C', display: 'block' }}>{displayName(p as Profile)}</span>
                        {p.apelido && <span style={{ fontSize: 10, color: '#9AA79C' }}>{p.full_name}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={handleSend}
                disabled={sending || (!text.trim() && !pendingFile)}
                style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: (text.trim() || pendingFile) ? '#3E9849' : '#EBE7DA',
                  color: (text.trim() || pendingFile) ? '#fff' : '#9AA79C',
                  border: 'none', cursor: (text.trim() || pendingFile) ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s, color 0.15s',
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </>
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8,
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#D4D0C3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              <path d="M8 9h8M8 13h6"/>
            </svg>
            <p style={{ fontSize: 14, color: '#9AA79C', fontWeight: 500 }}>Selecione um canal para iniciar</p>
          </div>
        )}
      </div>
    </div>
  )
}
