'use client'

import type { WaMessage } from './wa-types'

interface Props {
  msg: WaMessage
  isOut: boolean
  unitId: string | null
}

export default function MediaContent({ msg, isOut, unitId }: Props) {
  const tc = isOut ? '#fff' : '#0E2C3D'
  const sc = isOut ? '#ffffffaa' : '#8FA0AF'
  const mediaUrl = (id: string) => `/api/whatsapp/media?id=${id}${unitId ? `&unit_id=${unitId}` : ''}`

  if (msg.type === 'template')
    return <p style={{ margin: 0, fontSize: 13, color: tc, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content ?? msg.template_name}</p>

  if (msg.type === 'text' || (!msg.media_url && msg.content))
    return <p style={{ margin: 0, fontSize: 13, color: tc, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</p>

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
        {msg.content && <p style={{ margin: '4px 0 0', fontSize: 12, color: tc }}>{msg.content}</p>}
      </div>
    )

  if (msg.type === 'audio' && msg.media_url)
    return (
      <audio controls style={{ height: 32, maxWidth: 220 }}>
        <source src={mediaUrl(msg.media_url)} type={msg.media_mime_type ?? 'audio/ogg'} />
      </audio>
    )

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
