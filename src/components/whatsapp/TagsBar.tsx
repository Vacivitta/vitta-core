'use client'

import { useState, useEffect, useRef, type CSSProperties } from 'react'
import type { ConvTag } from './wa-types'

/** Onde as tags são aplicadas: no lead (`lead_tags`) ou na conversa (`wa_conversation_tags`). */
export interface AlvoTags { tipo: 'lead' | 'conversa'; id: string }

function rotaDoAlvo(alvo: AlvoTags): { url: string; campo: 'lead_id' | 'conversation_id' } {
  return alvo.tipo === 'lead'
    ? { url: '/api/leads/tags', campo: 'lead_id' }
    : { url: '/api/whatsapp/conversation-tags', campo: 'conversation_id' }
}

async function mensagemDeErro(res: Response): Promise<string> {
  const corpo = await res.json().catch(() => null) as { error?: unknown } | null
  return typeof corpo?.error === 'string' ? corpo.error : 'Não foi possível salvar a tag'
}

const estiloBarra: CSSProperties = { padding: '6px 14px', borderBottom: '1px solid #E9E5D8', background: '#fff', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }

export default function TagsBar({ alvo, tags, unitTags, onTagAdded, onTagRemoved, style }: {
  alvo: AlvoTags; tags: ConvTag[]
  /** Catálogo só do tipo do alvo (tags de cliente para o lead, de conversa para a conversa); o banco recusa o outro tipo. */
  unitTags: ConvTag[]
  onTagAdded: (tag: ConvTag) => void; onTagRemoved: (tagId: string) => void
  /** Substitui o estilo do contêiner (o padrão é a faixa do cabeçalho do chat). */
  style?: CSSProperties
}) {
  const [showPicker, setShowPicker] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [erro,       setErro]       = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false)
    }
    if (showPicker) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [showPicker])

  async function addTag(tag: ConvTag) {
    if (tags.some(t => t.id === tag.id)) { setShowPicker(false); return }
    const { url, campo } = rotaDoAlvo(alvo)
    setSaving(true); setErro('')
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [campo]: alvo.id, tag_id: tag.id }),
      })
      if (res.ok) onTagAdded(tag)
      else setErro(await mensagemDeErro(res))
    } catch {
      setErro('Sem conexão. Tente de novo.')
    } finally {
      setSaving(false)
      setShowPicker(false)
    }
  }

  async function removeTag(tagId: string) {
    const { url, campo } = rotaDoAlvo(alvo)
    setErro('')
    try {
      const params = new URLSearchParams({ [campo]: alvo.id, tag_id: tagId })
      const res = await fetch(`${url}?${params}`, { method: 'DELETE' })
      if (res.ok) onTagRemoved(tagId)
      else setErro(await mensagemDeErro(res))
    } catch {
      setErro('Sem conexão. Tente de novo.')
    }
  }

  const availableTags = unitTags.filter(t => !tags.some(ct => ct.id === t.id))

  if (unitTags.length === 0) return null

  return (
    <div style={style ?? estiloBarra}>
      {tags.map(tag => (
        <span key={tag.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}>
          {tag.name}
          <button onClick={() => void removeTag(tag.id)} aria-label={`Remover tag ${tag.name}`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: tag.color, fontSize: 11, fontWeight: 700, opacity: 0.7 }}>
            ×
          </button>
        </span>
      ))}
      <div style={{ position: 'relative' }} ref={pickerRef}>
        <button onClick={() => setShowPicker(v => !v)} disabled={saving}
          style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, border: '1px dashed #D1CBBA', cursor: 'pointer', background: 'transparent', color: '#9AA79C', display: 'flex', alignItems: 'center', gap: 3 }}>
          + {tags.length === 0 ? 'Tag' : ''}
        </button>
        {showPicker && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', border: '1px solid #E9E5D8', borderRadius: 10, boxShadow: '0 4px 16px rgba(37,64,44,0.12)', padding: 8, zIndex: 200, minWidth: 160 }}>
            {availableTags.length === 0 ? (
              <p style={{ fontSize: 11, color: '#9AA79C', margin: 0, padding: '4px 6px' }}>Todas as tags já foram adicionadas</p>
            ) : availableTags.map(tag => (
              <button key={tag.id} onClick={() => void addTag(tag)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 7, fontSize: 12, color: '#25402C', textAlign: 'left' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F6F4EC' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {erro && <span role="alert" style={{ fontSize: 10, fontWeight: 600, color: '#B91C1C' }}>{erro}</span>}
    </div>
  )
}
