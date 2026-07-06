'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { WaMessage } from './wa-types'

interface Props {
  msg: WaMessage
  isOut: boolean
  unitId: string | null
  timestamp?: React.ReactNode
}

/* ── WhatsApp text formatting ── */
function formatWaText(text: string): React.ReactNode[] {
  const regex = /(\*[^*\n]+\*)|(_[^_\n]+_)|(~[^~\n]+~)|(`[^`\n]+`)/g
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const m = match[0]
    const inner = m.slice(1, -1)
    if (m.startsWith('*'))      parts.push(<strong key={key++}>{inner}</strong>)
    else if (m.startsWith('_')) parts.push(<em key={key++}>{inner}</em>)
    else if (m.startsWith('~')) parts.push(<del key={key++}>{inner}</del>)
    else                        parts.push(<code key={key++} style={{ background: 'rgba(0,0,0,0.06)', borderRadius: 3, padding: '1px 4px', fontSize: 12 }}>{inner}</code>)
    last = match.index + m.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/* ── Audio player ── */
const SPEEDS = [1, 1.5, 2] as const

function AudioPlayer({ src, isOut, timestamp }: { src: string; isOut: boolean; timestamp?: React.ReactNode }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying]     = useState(false)
  const [duration, setDuration]   = useState(0)
  const [current, setCurrent]     = useState(0)
  const [speedIdx, setSpeedIdx]   = useState(0)
  const [loaded, setLoaded]       = useState(false)

  useEffect(() => {
    const a = ref.current
    if (!a) return
    const onMeta   = () => { setDuration(a.duration); setLoaded(true) }
    const onTime   = () => setCurrent(a.currentTime)
    const onEnded  = () => { setPlaying(false); setCurrent(0) }
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('ended', onEnded)
    return () => { a.removeEventListener('loadedmetadata', onMeta); a.removeEventListener('timeupdate', onTime); a.removeEventListener('ended', onEnded) }
  }, [])

  const toggle = useCallback(() => {
    const a = ref.current
    if (!a) return
    if (playing) { a.pause() } else { void a.play() }
    setPlaying(p => !p)
  }, [playing])

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const a = ref.current
    if (!a || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    a.currentTime = pct * duration
    setCurrent(a.currentTime)
  }, [duration])

  const cycleSpeed = useCallback(() => {
    const next = (speedIdx + 1) % SPEEDS.length
    setSpeedIdx(next)
    if (ref.current) ref.current.playbackRate = SPEEDS[next]
  }, [speedIdx])

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const pct = duration ? (current / duration) * 100 : 0
  const accent = isOut ? '#fff' : '#25D366'
  const track  = isOut ? 'rgba(255,255,255,0.3)' : '#DFE5E7'
  const text   = isOut ? '#fff' : '#667781'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 240 }}>
      <audio ref={ref} src={src} preload="metadata" />

      <button onClick={toggle} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}>
        {playing ? (
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="14" r="14" fill={accent} opacity={isOut ? 0.25 : 0.15} />
            <rect x="10" y="9" width="3" height="10" rx="1" fill={accent} />
            <rect x="15" y="9" width="3" height="10" rx="1" fill={accent} />
          </svg>
        ) : (
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="14" r="14" fill={accent} opacity={isOut ? 0.25 : 0.15} />
            <path d="M11 9v10l8-5z" fill={accent} />
          </svg>
        )}
      </button>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <div onClick={seek} style={{ height: 4, background: track, borderRadius: 2, cursor: 'pointer', position: 'relative' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: accent, borderRadius: 2, transition: 'width 0.1s linear' }} />
          <div style={{ position: 'absolute', top: '50%', left: `${pct}%`, transform: 'translate(-50%, -50%)', width: 10, height: 10, borderRadius: '50%', background: accent, boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.1s linear' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: text, minWidth: 28 }}>{fmt(current || duration)}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={cycleSpeed}
            style={{ background: isOut ? 'rgba(255,255,255,0.2)' : '#E9EDEF', border: 'none', borderRadius: 8, padding: '1px 5px', fontSize: 9, fontWeight: 700, color: text, cursor: 'pointer', lineHeight: '14px' }}
          >
            {SPEEDS[speedIdx]}x
          </button>
          {timestamp}
        </div>
      </div>
    </div>
  )
}

export default function MediaContent({ msg, isOut, unitId, timestamp }: Props) {
  const tc = isOut ? '#fff' : '#0E2C3D'
  const sc = isOut ? '#ffffffaa' : '#8FA0AF'
  const mediaUrl = (id: string) => `/api/whatsapp/media?id=${id}${unitId ? `&unit_id=${unitId}` : ''}`

  if (msg.type === 'template')
    return <>{msg.content ? formatWaText(msg.content) : msg.template_name}</>

  if (msg.type === 'text' || (!msg.media_url && msg.content))
    return <>{formatWaText(msg.content ?? '')}</>

  if (msg.type === 'sticker' && msg.media_url)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={mediaUrl(msg.media_url)}
        alt="Sticker"
        style={{ width: 128, height: 128, objectFit: 'contain', display: 'block' }}
      />
    )

  if (msg.type === 'image' && msg.media_url)
    return (
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaUrl(msg.media_url)}
          alt="Imagem"
          style={{ maxWidth: 220, maxHeight: 200, borderRadius: 8, display: 'block', cursor: 'pointer' }}
          onClick={() => window.open(mediaUrl(msg.media_url!), '_blank')}
        />
        {msg.content && <p style={{ margin: '4px 0 0', fontSize: 12, color: tc }}>{formatWaText(msg.content)}</p>}
      </div>
    )

  if (msg.type === 'audio' && msg.media_url)
    return <AudioPlayer src={mediaUrl(msg.media_url)} isOut={isOut} timestamp={timestamp} />

  if (msg.type === 'video' && msg.media_url)
    return (
      <video controls style={{ maxWidth: 220, maxHeight: 180, borderRadius: 8 }}>
        <source src={mediaUrl(msg.media_url)} type={msg.media_mime_type ?? 'video/mp4'} />
      </video>
    )

  if (msg.type === 'document' && msg.media_url)
    return (
      <a href={mediaUrl(msg.media_url)} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: tc }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{msg.content ?? 'Arquivo'}</span>
      </a>
    )

  return <p style={{ margin: 0, fontSize: 12, color: sc, fontStyle: 'italic' }}>[{msg.type}]</p>
}
