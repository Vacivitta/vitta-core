'use client'

import { useState, useEffect, useRef } from 'react'
import type { ConvTag } from './wa-types'

export default function ConvTagsBar({ convId, convTags, unitTags, onTagAdded, onTagRemoved }: {
  convId: string; convTags: ConvTag[]; unitTags: ConvTag[]
  onTagAdded: (tag: ConvTag) => void; onTagRemoved: (tagId: string) => void
}) {
  const [showPicker, setShowPicker] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false)
    }
    if (showPicker) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [showPicker])

  async function addTag(tag: ConvTag) {
    if (convTags.some(t => t.id === tag.id)) { setShowPicker(false); return }
    setSaving(true)
    await fetch('/api/whatsapp/conversation-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: convId, tag_id: tag.id }),
    })
    onTagAdded(tag)
    setSaving(false)
    setShowPicker(false)
  }

  async function removeTag(tagId: string) {
    await fetch(`/api/whatsapp/conversation-tags?conversation_id=${convId}&tag_id=${tagId}`, { method: 'DELETE' })
    onTagRemoved(tagId)
  }

  const availableTags = unitTags.filter(t => !convTags.some(ct => ct.id === t.id))

  if (unitTags.length === 0) return null

  return (
    <div style={{ padding: '6px 14px', borderBottom: '1px solid #E9E5D8', background: '#fff', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
      {convTags.map(tag => (
        <span key={tag.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}>
          {tag.name}
          <button onClick={() => void removeTag(tag.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: tag.color, fontSize: 11, fontWeight: 700, opacity: 0.7 }}>
            ×
          </button>
        </span>
      ))}
      <div style={{ position: 'relative' }} ref={pickerRef}>
        <button onClick={() => setShowPicker(v => !v)} disabled={saving}
          style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, border: '1px dashed #D1CBBA', cursor: 'pointer', background: 'transparent', color: '#9AA79C', display: 'flex', alignItems: 'center', gap: 3 }}>
          + {convTags.length === 0 ? 'Tag' : ''}
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
    </div>
  )
}
