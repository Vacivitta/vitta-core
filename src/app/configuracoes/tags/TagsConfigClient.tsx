'use client'

import { useState, type CSSProperties } from 'react'
import type { TipoTag, WaTag } from '@/types/database'
import { ROTULO_TIPO_TAG, TIPOS_TAG, tagsDoTipo } from '@/lib/tags'

const PRESET_COLORS = [
  '#6B7280', '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#06B6D4',
]

const AJUDA_TIPO: Record<TipoTag, string> = {
  lead:     'Aplicadas na ficha do cliente. Filtram o funil, as campanhas e a exportação.',
  conversa: 'Aplicadas na conversa do WhatsApp, no Atendimento. Também aparecem no card do funil.',
}

const rotuloCampo: CSSProperties = { fontSize: 12, fontWeight: 700, color: '#71856F', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }

function SeletorTipo({ valor, onChange, pequeno = false }: { valor: TipoTag; onChange: (t: TipoTag) => void; pequeno?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Tipo da tag" style={{ display: 'inline-flex', border: '1.5px solid #EBE7DA', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
      {TIPOS_TAG.map(t => (
        <button key={t} type="button" role="radio" aria-checked={valor === t} onClick={() => onChange(t)}
          style={{ padding: pequeno ? '5px 10px' : '8px 14px', fontSize: pequeno ? 12 : 13, fontWeight: 700, border: 'none', cursor: 'pointer',
            background: valor === t ? '#3E9849' : 'transparent', color: valor === t ? '#fff' : '#71856F' }}>
          {ROTULO_TIPO_TAG[t]}
        </button>
      ))}
    </div>
  )
}

function ordenar(lista: WaTag[]): WaTag[] {
  return lista.sort((a, b) => a.name.localeCompare(b.name))
}

export default function TagsConfigClient({ initialTags }: { initialTags: WaTag[] }) {
  const [tags,    setTags]    = useState<WaTag[]>(initialTags)
  const [name,    setName]    = useState('')
  const [color,   setColor]   = useState(PRESET_COLORS[4])
  const [tipo,    setTipo]    = useState<TipoTag>('lead')
  const [aba,     setAba]     = useState<TipoTag>('lead')
  const [saving,  setSaving]  = useState(false)
  const [editId,  setEditId]  = useState<string | null>(null)
  const [editName,  setEditName]  = useState('')
  const [editColor, setEditColor] = useState('')
  const [editTipo,  setEditTipo]  = useState<TipoTag>('lead')
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
        body: JSON.stringify({ name: name.trim(), color, tipo }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Erro ao criar tag'); return }
      setTags(prev => ordenar([...prev, data as WaTag]))
      setName(''); setColor(PRESET_COLORS[4])
      setAba(tipo)
    } catch {
      setError('Erro de conexão ao criar tag')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEdit(tag: WaTag) {
    if (!editName.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/whatsapp/tags?id=${tag.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), color: editColor, ...(editTipo !== tag.tipo && { tipo: editTipo }) }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Erro ao salvar'); return }
      setTags(prev => ordenar(prev.map(t => t.id === tag.id ? data as WaTag : t)))
      setEditId(null)
    } catch {
      setError('Erro de conexão ao salvar tag')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(tag: WaTag) {
    const onde = tag.tipo === 'lead' ? 'de todos os clientes' : 'de todas as conversas'
    if (!window.confirm(`Excluir a tag "${tag.name}"? Ela será removida ${onde}.`)) return
    const res = await fetch(`/api/whatsapp/tags?id=${tag.id}`, { method: 'DELETE' })
    if (!res.ok) { setError('Erro ao excluir'); return }
    setTags(prev => prev.filter(t => t.id !== tag.id))
  }

  const daAba = tagsDoTipo(tags, aba)

  return (
    <div style={{ padding: '32px 40px', maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#25402C', margin: '0 0 4px', letterSpacing: '-0.01em' }}>
        Tags
      </h1>
      <p style={{ fontSize: 14, color: '#9AA79C', marginBottom: 28 }}>
        Tags de <strong>cliente</strong> marcam a ficha do cliente; tags de <strong>conversa</strong> marcam o atendimento no WhatsApp.
        Cada lugar mostra só as tags do seu tipo.
      </p>

      {/* Create form */}
      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <span style={rotuloCampo}>Tipo</span>
            <SeletorTipo valor={tipo} onChange={setTipo} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="nova-tag" style={rotuloCampo}>Nova tag</label>
            <input
              id="nova-tag"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={tipo === 'lead' ? 'Ex: VIP, Gestante, Empresa...' : 'Ex: Urgente, Follow-up, Aguardando...'}
              style={{ width: '100%', padding: '9px 12px', fontSize: 13, border: '1.5px solid #EBE7DA', borderRadius: 10, outline: 'none', color: '#25402C' }}
              onFocus={e => { e.currentTarget.style.borderColor = '#3E9849' }}
              onBlur={e => { e.currentTarget.style.borderColor = '#EBE7DA' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <span style={rotuloCampo}>Cor</span>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '7px 10px', border: '1.5px solid #EBE7DA', borderRadius: 10, background: '#fff' }}>
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Cor ${c}`}
                  style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: color === c ? '2.5px solid #25402C' : '2px solid transparent', cursor: 'pointer', flexShrink: 0 }} />
              ))}
            </div>
          </div>
          <button type="submit" disabled={saving || !name.trim()}
            style={{ padding: '9px 18px', background: name.trim() ? '#3E9849' : '#EBE7DA', color: name.trim() ? '#fff' : '#9AA79C', fontWeight: 700, fontSize: 13, border: 'none', borderRadius: 10, cursor: name.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {saving ? 'Criando...' : `+ Criar tag de ${ROTULO_TIPO_TAG[tipo].toLowerCase()}`}
          </button>
        </div>
      </form>

      {error && <p role="alert" style={{ fontSize: 13, color: '#C05B3A', background: '#FDE8E2', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>{error}</p>}

      {/* Abas por tipo */}
      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid #EBE7DA', marginBottom: 8 }}>
        {TIPOS_TAG.map(t => (
          <button key={t} type="button" role="tab" aria-selected={aba === t} onClick={() => { setAba(t); setEditId(null) }}
            style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', marginBottom: -1,
              borderBottom: aba === t ? '2px solid #3E9849' : '2px solid transparent', color: aba === t ? '#25402C' : '#9AA79C' }}>
            {ROTULO_TIPO_TAG[t]} ({tagsDoTipo(tags, t).length})
          </button>
        ))}
      </div>
      <p style={{ fontSize: 12, color: '#9AA79C', margin: '0 0 12px' }}>{AJUDA_TIPO[aba]}</p>

      {/* Tag list */}
      {daAba.length === 0 ? (
        <p style={{ fontSize: 13, color: '#9AA79C', textAlign: 'center', padding: '40px 0' }}>
          Nenhuma tag de {ROTULO_TIPO_TAG[aba].toLowerCase()} criada ainda.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {daAba.map(tag => (
            <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid #EBE7DA', borderRadius: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
              {editId === tag.id ? (
                <>
                  <input value={editName} onChange={e => setEditName(e.target.value)} aria-label="Nome da tag"
                    style={{ flex: 1, minWidth: 140, padding: '6px 10px', fontSize: 13, border: '1.5px solid #3E9849', borderRadius: 8, outline: 'none' }}
                    autoFocus />
                  <div style={{ display: 'flex', gap: 4 }}>
                    {PRESET_COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setEditColor(c)} aria-label={`Cor ${c}`}
                        style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: editColor === c ? '2.5px solid #25402C' : '2px solid transparent', cursor: 'pointer' }} />
                    ))}
                  </div>
                  <SeletorTipo valor={editTipo} onChange={setEditTipo} pequeno />
                  <button onClick={() => void handleSaveEdit(tag)} disabled={saving}
                    style={{ padding: '6px 14px', background: '#3E9849', color: '#fff', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                    Salvar
                  </button>
                  <button onClick={() => setEditId(null)}
                    style={{ padding: '6px 10px', background: 'none', color: '#9AA79C', fontSize: 12, border: '1px solid #EBE7DA', borderRadius: 8, cursor: 'pointer' }}>
                    Cancelar
                  </button>
                  {editTipo !== tag.tipo && (
                    <p style={{ width: '100%', fontSize: 12, color: '#9AA79C', margin: 0 }}>
                      Só dá para mudar o tipo de uma tag que ainda não foi aplicada em nenhum cliente nem conversa.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: tag.color, flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#25402C', flex: 1 }}>{tag.name}</span>
                  <button onClick={() => { setEditId(tag.id); setEditName(tag.name); setEditColor(tag.color); setEditTipo(tag.tipo); setError('') }}
                    style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #EBE7DA', borderRadius: 8, cursor: 'pointer', background: 'none', color: '#71856F' }}>
                    Editar
                  </button>
                  <button onClick={() => void handleDelete(tag)}
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
