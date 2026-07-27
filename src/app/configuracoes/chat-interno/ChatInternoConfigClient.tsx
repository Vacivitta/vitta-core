'use client'

import { useState, useEffect } from 'react'
import type { InternalChannel, Unit } from '@/types/database'

export default function ChatInternoConfigClient() {
  const [units, setUnits] = useState<Pick<Unit, 'id' | 'nome'>[]>([])
  const [channels, setChannels] = useState<InternalChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [unitA, setUnitA] = useState('')
  const [unitB, setUnitB] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const res = await fetch('/api/internal-chat/channels')
    if (res.ok) {
      const data = await res.json()
      setUnits(data.units ?? [])
      setChannels((data.channels ?? []) as InternalChannel[])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!unitA || !unitB || unitA === unitB) {
      setError('Selecione duas unidades diferentes')
      return
    }
    setSaving(true)
    setError('')
    const res = await fetch('/api/internal-chat/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit_a_id: unitA, unit_b_id: unitB }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Erro ao criar canal')
    } else {
      setUnitA('')
      setUnitB('')
      await load()
    }
    setSaving(false)
  }

  async function handleDeactivate(id: string, nameA: string, nameB: string) {
    if (!window.confirm(`Desativar o canal entre "${nameA}" e "${nameB}"?`)) return
    const res = await fetch(`/api/internal-chat/channels?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      setChannels(prev => prev.filter(c => c.id !== id))
    } else {
      setError('Erro ao desativar canal')
    }
  }

  const unitName = (id: string) => units.find(u => u.id === id)?.nome ?? 'Unidade'

  return (
    <div style={{ padding: '32px 40px', maxWidth: 700 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#25402C', margin: '0 0 4px', letterSpacing: '-0.01em' }}>
        Chat Interno
      </h1>
      <p style={{ fontSize: 14, color: '#9AA79C', marginBottom: 28 }}>
        Gerencie os canais de conversa entre unidades. Cada canal permite que todos os membros das duas unidades conversem.
      </p>

      {/* Create form */}
      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 28, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#71856F', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Unidade A
          </label>
          <select
            value={unitA}
            onChange={e => setUnitA(e.target.value)}
            style={{
              width: '100%', padding: '9px 12px', fontSize: 13,
              border: '1.5px solid #EBE7DA', borderRadius: 10, outline: 'none',
              color: '#25402C', background: '#fff', cursor: 'pointer',
            }}
          >
            <option value="">Selecione...</option>
            {units.map(u => (
              <option key={u.id} value={u.id}>{u.nome}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 4, color: '#9AA79C', fontWeight: 700, fontSize: 18 }}>
          ↔
        </div>

        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#71856F', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Unidade B
          </label>
          <select
            value={unitB}
            onChange={e => setUnitB(e.target.value)}
            style={{
              width: '100%', padding: '9px 12px', fontSize: 13,
              border: '1.5px solid #EBE7DA', borderRadius: 10, outline: 'none',
              color: '#25402C', background: '#fff', cursor: 'pointer',
            }}
          >
            <option value="">Selecione...</option>
            {units.filter(u => u.id !== unitA).map(u => (
              <option key={u.id} value={u.id}>{u.nome}</option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={saving || !unitA || !unitB}
          style={{
            padding: '9px 20px', fontSize: 13, fontWeight: 700,
            border: 'none', borderRadius: 10, cursor: 'pointer',
            background: unitA && unitB ? '#3E9849' : '#EBE7DA',
            color: unitA && unitB ? '#fff' : '#9AA79C',
            transition: 'background 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          {saving ? 'Criando...' : 'Criar Canal'}
        </button>
      </form>

      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, fontSize: 13,
          background: '#FEF2F2', color: '#DC2626', marginBottom: 20,
          border: '1px solid #FECACA',
        }}>
          {error}
        </div>
      )}

      {/* Channel list */}
      <div>
        <label style={{ fontSize: 12, fontWeight: 700, color: '#71856F', display: 'block', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Canais ativos ({channels.filter(c => c.ativo).length})
        </label>

        {loading ? (
          <p style={{ fontSize: 13, color: '#9AA79C' }}>Carregando...</p>
        ) : channels.filter(c => c.ativo).length === 0 ? (
          <div style={{
            padding: '32px 20px', textAlign: 'center',
            border: '1.5px dashed #EBE7DA', borderRadius: 12,
          }}>
            <p style={{ fontSize: 13, color: '#9AA79C' }}>Nenhum canal criado ainda</p>
            <p style={{ fontSize: 12, color: '#B5B0A1', marginTop: 4 }}>
              Selecione duas unidades acima para criar o primeiro canal.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {channels.filter(c => c.ativo).map(ch => {
              const nameA = ch.unit_a?.nome ?? unitName(ch.unit_a_id)
              const nameB = ch.unit_b?.nome ?? unitName(ch.unit_b_id)
              return (
                <div
                  key={ch.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px', border: '1.5px solid #EBE7DA',
                    borderRadius: 12, background: '#fff',
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: '#E8F4E6', color: '#3E9849',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#25402C', margin: 0 }}>
                      {nameA}
                      <span style={{ color: '#9AA79C', fontWeight: 400, margin: '0 8px' }}>↔</span>
                      {nameB}
                    </p>
                    <p style={{ fontSize: 11, color: '#9AA79C', margin: '2px 0 0' }}>
                      Criado em {new Date(ch.criado_em).toLocaleDateString('pt-BR')}
                    </p>
                  </div>

                  <button
                    onClick={() => handleDeactivate(ch.id, nameA, nameB)}
                    title="Desativar canal"
                    style={{
                      width: 32, height: 32, borderRadius: 8,
                      border: '1px solid #FECACA', background: '#FEF2F2',
                      color: '#DC2626', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, transition: 'background 0.15s',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
