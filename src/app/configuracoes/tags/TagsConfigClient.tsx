'use client'

import { useState } from 'react'
import type { WaTag } from '@/types/database'

const PRESET_COLORS = [
  '#6B7280', '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#06B6D4',
]

export default function TagsConfigClient({ initialTags }: { initialTags: WaTag[] }) {
  const [tags,    setTags]    = useState<WaTag[]>(initialTags)
  const [name,    setName]    = useState('')
  const [color,   setColor]   = useState(PRESET_COLORS[4])
  const [saving,  setSaving]  = useState(false)
  const [editId,  setEditId]  = useState<string | null>(null)
  const [editName,  setEditName]  = useState('')
  const [editColor, setEditColor] = useState('')
  const [error,   setError]   = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/whatsapp/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Erro ao criar tag'); return }
      setTags(prev => [...prev, data as WaTag].sort((a, b) => a.name.localeCompare(b.name)))
      setName(''); setColor(PRESET_COLORS[4])
    } catch {
      setError('Erro de conexão ao criar tag')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEdit(id: string) {
    if (!editName.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/whatsapp/tags?id=${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Erro ao salvar'); return }
      setTags(prev => prev.map(t => t.id === id ? data as WaTag : t).sort((a, b) => a.name.localeCompare(b.name)))
      setEditId(null)
    } catch {
      setError('Erro de conexão ao salvar tag')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, tagName: string) {
    if (!window.confirm(`Excluir a tag "${tagName}"? Ela será removida de todas as conversas.`)) return
    const res = await fetch(`/api/whatsapp/tags?id=${id}`, { method: 'DELETE' })
    if (!res.ok) { setError('Erro ao excluir'); return }
    setTags(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 600 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#25402C', margin: '0 0 4px', letterSpacing: '-0.01em' }}>
        Tags de Conversa
      </h1>
      <p style={{ fontSize: 14, color: '#9AA79C', marginBottom: 28 }}>
        Classifique conversas do WhatsApp com tags coloridas e filtre por elas no atendimento.
      </p>

      {/* Create form */}
      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 28 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#71856F', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Nova tag</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Urgente, Follow-up, VIP..."
            style={{ width: '100%', padding: '9px 12px', fontSize: 13, border: '1.5px solid #EBE7DA', borderRadius: 10, outline: 'none', color: '#25402C' }}
            onFocus={e => { e.currentTarget.style.borderColor = '#3E9849' }}
            onBlur={e => { e.currentTarget.style.borderColor = '#EBE7DA' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#71856F', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cor</label>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '7px 10px', border: '1.5px solid #EBE7DA', borderRadius: 10, background: '#fff' }}>
            {PRESET_COLORS.map(c => (
              <button key={c} type="button" onClick={() => setColor(c)}
                style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: color === c ? '2.5px solid #25402C' : '2px solid transparent', cursor: 'pointer', flexShrink: 0 }} />
            ))}
          </div>
        </div>
        <button type="submit" disabled={saving || !name.trim()}
          style={{ padding: '9px 18px', background: name.trim() ? '#3E9849' : '#EBE7DA', color: name.trim() ? '#fff' : '#9AA79C', fontWeight: 700, fontSize: 13, border: 'none', borderRadius: 10, cursor: name.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {saving ? 'Criando...' : '+ Criar'}
        </button>
      </form>

      {error && <p style={{ fontSize: 13, color: '#C05B3A', background: '#FDE8E2', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>{error}</p>}

      {/* Tag list */}
      {tags.length === 0 ? (
        <p style={{ fontSize: 13, color: '#9AA79C', textAlign: 'center', padding: '40px 0' }}>Nenhuma tag criada ainda.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tags.map(tag => (
            <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid #EBE7DA', borderRadius: 12, padding: '12px 16px' }}>
              {editId === tag.id ? (
                <>
                  <input value={editName} onChange={e => setEditName(e.target.value)}
                    style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: '1.5px solid #3E9849', borderRadius: 8, outline: 'none' }}
                    autoFocus />
                  <div style={{ display: 'flex', gap: 4 }}>
                    {PRESET_COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setEditColor(c)}
                        style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: editColor === c ? '2.5px solid #25402C' : '2px solid transparent', cursor: 'pointer' }} />
                    ))}
                  </div>
                  <button onClick={() => handleSaveEdit(tag.id)} disabled={saving}
                    style={{ padding: '6px 14px', background: '#3E9849', color: '#fff', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                    Salvar
                  </button>
                  <button onClick={() => setEditId(null)}
                    style={{ padding: '6px 10px', background: 'none', color: '#9AA79C', fontSize: 12, border: '1px solid #EBE7DA', borderRadius: 8, cursor: 'pointer' }}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: tag.color, flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#25402C', flex: 1 }}>{tag.name}</span>
                  <button onClick={() => { setEditId(tag.id); setEditName(tag.name); setEditColor(tag.color) }}
                    style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #EBE7DA', borderRadius: 8, cursor: 'pointer', background: 'none', color: '#71856F' }}>
                    Editar
                  </button>
                  <button onClick={() => handleDelete(tag.id, tag.name)}
                    style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #FECACA', borderRadius: 8, cursor: 'pointer', background: 'none', color: '#EF4444' }}>
                    Excluir
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
