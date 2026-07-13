'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
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

/* ── Waveform bars ── */
const BAR_COUNT = 36

function generateBars(seed: string): number[] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0
  const bars: number[] = []
  for (let i = 0; i < BAR_COUNT; i++) {
    h = ((h << 5) - h + i * 7 + 13) | 0
    bars.push(0.15 + 0.85 * (Math.abs(h % 100) / 100))
  }
  return bars
}

/* ── Audio player (WhatsApp style) ── */
const SPEEDS = [1, 1.5, 2] as const

function AudioPlayer({ src, isOut, timestamp, msgId }: { src: string; isOut: boolean; timestamp?: React.ReactNode; msgId?: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying]     = useState(false)
  const [duration, setDuration]   = useState(0)
  const [current, setCurrent]     = useState(0)
  const [speedIdx, setSpeedIdx]   = useState(0)

  const bars = useMemo(() => generateBars(msgId || src), [msgId, src])

  useEffect(() => {
    const a = ref.current
    if (!a) return
    const onMeta   = () => setDuration(a.duration)
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

  const playBtnBg   = isOut ? '#fff' : '#00A884'
  const playIconFill = isOut ? '#4FAD5B' : '#fff'
  const barPlayed   = isOut ? '#3B8C4A' : '#00A884'
  const barUnplayed = isOut ? 'rgba(59,140,74,0.35)' : '#CBD5D8'
  const textColor   = isOut ? '#1D4226' : '#667781'
  const speedBg     = isOut ? 'rgba(59,140,74,0.2)' : '#E9EDEF'
  const speedColor  = isOut ? '#1D4226' : '#667781'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 260, padding: '2px 0' }}>
      <audio ref={ref} src={src} preload="metadata" />

      <button onClick={toggle} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}>
        {playing ? (
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="16" fill={playBtnBg} />
            <rect x="11" y="10" width="3.5" height="12" rx="1" fill={playIconFill} />
            <rect x="17.5" y="10" width="3.5" height="12" rx="1" fill={playIconFill} />
          </svg>
        ) : (
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="16" fill={playBtnBg} />
            <path d="M13 10v12l9-6z" fill={playIconFill} />
          </svg>
        )}
      </button>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <div onClick={seek} style={{ display: 'flex', alignItems: 'center', gap: 1, height: 24, cursor: 'pointer', position: 'relative' }}>
          {bars.map((h, i) => {
            const barPct = ((i + 0.5) / BAR_COUNT) * 100
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${h * 100}%`,
                  minWidth: 2,
                  maxWidth: 4,
                  borderRadius: 1,
                  background: barPct <= pct ? barPlayed : barUnplayed,
                  transition: 'background 0.1s',
                }}
              />
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: textColor, minWidth: 28, fontWeight: 500 }}>{fmt(playing ? current : duration)}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={cycleSpeed}
            style={{ background: speedBg, border: 'none', borderRadius: 8, padding: '1px 5px', fontSize: 9, fontWeight: 700, color: speedColor, cursor: 'pointer', lineHeight: '14px' }}
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
  const tc = isOut ? '#25402C' : '#25402C'
  const sc = isOut ? '#ffffffaa' : '#9AA79C'
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
    return <AudioPlayer src={mediaUrl(msg.media_url)} isOut={isOut} timestamp={timestamp} msgId={msg.id} />

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
