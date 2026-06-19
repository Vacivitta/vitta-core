'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { displayName } from '@/types/database'
import type { Profile } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Fila {
  id: string; nome: string; cor: string; ativo: boolean; created_at: string
  auto_assign: boolean; distribution_method: string; max_per_agent: number
}

type Agent = { id: string; full_name: string; apelido: string | null }

interface Props {
  currentUser: Profile
  initialFilas: Fila[]
  initialAgents: Agent[]
  initialQueueAgents: Record<string, string[]>
}

const PRESET_COLORS = [
  '#0098DA', '#25D366', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
  '#6366F1', '#84CC16', '#06B6D4', '#0E2C3D',
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function FilasConfig({ currentUser, initialFilas, initialAgents, initialQueueAgents }: Props) {
  const supabase = createClient()
  const [filas,       setFilas]       = useState<Fila[]>(initialFilas)
  const [queueAgents, setQueueAgents] = useState<Record<string, string[]>>(initialQueueAgents)
  const [saving,      setSaving]      = useState<string | null>(null)
  const [deleting,    setDeleting]    = useState<string | null>(null)
  const [showForm,    setShowForm]    = useState(false)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editNome,    setEditNome]    = useState('')
  const [editCor,     setEditCor]     = useState('#0098DA')
  const [newNome,     setNewNome]     = useState('')
  const [newCor,      setNewCor]      = useState('#0098DA')
  const [error,       setError]       = useState<string | null>(null)

  const [editAutoAssign, setEditAutoAssign] = useState(false)
  const [editMethod,     setEditMethod]     = useState('round_robin')
  const [editMax,        setEditMax]        = useState(10)
  const [editAgentIds,   setEditAgentIds]   = useState<string[]>([])

  async function createFila() {
    if (!newNome.trim()) return
    setError(null); setSaving('new')
    const { data, error: err } = await supabase
      .from('wa_queues')
      .insert({ unit_id: currentUser.unit_id, nome: newNome.trim(), cor: newCor, ativo: true })
      .select('id,nome,cor,ativo,created_at,auto_assign,distribution_method,max_per_agent').single()
    setSaving(null)
    if (err) { setError(err.message); return }
    setFilas(prev => [...prev, data as Fila].sort((a, b) => a.nome.localeCompare(b.nome)))
    setNewNome(''); setNewCor('#0098DA'); setShowForm(false)
  }

  function startEdit(f: Fila) {
    setEditingId(f.id); setEditNome(f.nome); setEditCor(f.cor)
    setEditAutoAssign(f.auto_assign ?? false)
    setEditMethod(f.distribution_method ?? 'round_robin')
    setEditMax(f.max_per_agent ?? 10)
    setEditAgentIds(queueAgents[f.id] ?? [])
  }

  async function saveEdit(id: string) {
    if (!editNome.trim()) return
    setSaving(id)

    await supabase.from('wa_queues').update({
      nome: editNome.trim(), cor: editCor,
      auto_assign: editAutoAssign, distribution_method: editMethod, max_per_agent: editMax,
    }).eq('id', id)

    // Sync queue agents: delete all then insert selected
    await supabase.from('wa_queue_agents').delete().eq('queue_id', id)
    if (editAgentIds.length > 0) {
      await supabase.from('wa_queue_agents').insert(
        editAgentIds.map(agent_id => ({ queue_id: id, agent_id }))
      )
    }

    setFilas(prev => prev.map(f => f.id === id ? {
      ...f, nome: editNome.trim(), cor: editCor,
      auto_assign: editAutoAssign, distribution_method: editMethod, max_per_agent: editMax,
    } : f))
    setQueueAgents(prev => ({ ...prev, [id]: editAgentIds }))
    setSaving(null); setEditingId(null)
  }

  async function toggleAutoAssign(f: Fila) {
    setSaving(f.id)
    const next = !f.auto_assign
    await supabase.from('wa_queues').update({ auto_assign: next }).eq('id', f.id)
    setFilas(prev => prev.map(q => q.id === f.id ? { ...q, auto_assign: next } : q))
    setSaving(null)
  }

  async function toggleAtivo(f: Fila) {
    setSaving(f.id)
    await supabase.from('wa_queues').update({ ativo: !f.ativo }).eq('id', f.id)
    setFilas(prev => prev.map(q => q.id === f.id ? { ...q, ativo: !q.ativo } : q))
    setSaving(null)
  }

  async function deleteFila(f: Fila) {
    const { count } = await supabase.from('wa_conversations').select('id', { count: 'exact', head: true })
      .eq('queue_id', f.id).neq('status', 'resolved')
    if ((count ?? 0) > 0) {
      setError(`Não é possível deletar "${f.nome}": há ${count} conversa(s) ativa(s) nesta fila. Reatribua-as primeiro.`)
      return
    }
    if (!confirm(`Deletar a fila "${f.nome}" permanentemente?`)) return
    setDeleting(f.id)
    await supabase.from('wa_queues').delete().eq('id', f.id)
    setFilas(prev => prev.filter(q => q.id !== f.id))
    setDeleting(null)
  }

  const active   = filas.filter(f => f.ativo)
  const inactive = filas.filter(f => !f.ativo)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 720, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0E2C3D', margin: 0 }}>Filas de Atendimento</h1>
          <p style={{ fontSize: 13, color: '#8FA0AF', margin: '4px 0 0' }}>
            Organize conversas em filas (ex: Comercial, Financeiro, Suporte). Atribua conversas a filas pelo painel do chat.
          </p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ padding: '9px 18px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 9, background: '#0098DA', color: '#fff', cursor: 'pointer', flexShrink: 0 }}>
          + Nova fila
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 9, marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: '#DC2626', margin: 0 }}>{error}</p>
          <button onClick={() => setError(null)} style={{ fontSize: 10, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4, textDecoration: 'underline' }}>Fechar</button>
        </div>
      )}

      {/* Form nova fila */}
      {showForm && (
        <div style={{ background: '#F0F8FF', border: '1px solid #B3DFFF', borderRadius: 12, padding: '18px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#0E2C3D', marginBottom: 12, marginTop: 0 }}>Nova fila</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={labelStyle}>Nome</label>
              <input value={newNome} onChange={e => setNewNome(e.target.value)} placeholder="ex: Comercial"
                onKeyDown={e => e.key === 'Enter' && void createFila()}
                style={inputStyle} autoFocus />
            </div>
            <div>
              <label style={labelStyle}>Cor</label>
              <ColorPicker value={newCor} onChange={setNewCor} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={() => { setShowForm(false); setNewNome(''); setNewCor('#0098DA') }}
              style={{ padding: '7px 14px', fontSize: 12, border: '1px solid #E8EDF2', borderRadius: 8, cursor: 'pointer', background: '#fff', color: '#5A7184', fontWeight: 600 }}>
              Cancelar
            </button>
            <button onClick={() => void createFila()} disabled={saving === 'new' || !newNome.trim()}
              style={{ padding: '7px 18px', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 8, cursor: newNome.trim() ? 'pointer' : 'default', background: newNome.trim() ? '#0098DA' : '#E8EDF2', color: newNome.trim() ? '#fff' : '#B0BEC9', opacity: saving === 'new' ? 0.7 : 1 }}>
              {saving === 'new' ? 'Salvando...' : 'Criar fila'}
            </button>
          </div>
        </div>
      )}

      {active.length === 0 && !showForm && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#B0BEC9' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#5A7184', margin: 0 }}>Nenhuma fila criada</p>
          <p style={{ fontSize: 12, margin: '4px 0 0' }}>Crie filas para organizar o atendimento por equipe ou assunto.</p>
        </div>
      )}

      {active.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#8FA0AF', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Ativas ({active.length})</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {active.map(f => (
              <FilaRow key={f.id} fila={f} editing={editingId === f.id}
                editNome={editNome} editCor={editCor} editAutoAssign={editAutoAssign} editMethod={editMethod} editMax={editMax}
                onEditNome={setEditNome} onEditCor={setEditCor}
                onEditAutoAssign={setEditAutoAssign} onEditMethod={setEditMethod} onEditMax={setEditMax}
                availableAgents={initialAgents} editAgentIds={editAgentIds} onEditAgentIds={setEditAgentIds}
                queueAgentIds={queueAgents[f.id] ?? []}
                saving={saving === f.id} deleting={deleting === f.id}
                onStartEdit={() => startEdit(f)} onSaveEdit={() => void saveEdit(f.id)} onCancelEdit={() => setEditingId(null)}
                onToggle={() => void toggleAtivo(f)} onDelete={() => void deleteFila(f)}
                onToggleAutoAssign={() => void toggleAutoAssign(f)} />
            ))}
          </div>
        </>
      )}

      {inactive.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#B0BEC9', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Inativas ({inactive.length})</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {inactive.map(f => (
              <FilaRow key={f.id} fila={f} editing={editingId === f.id}
                editNome={editNome} editCor={editCor} editAutoAssign={editAutoAssign} editMethod={editMethod} editMax={editMax}
                onEditNome={setEditNome} onEditCor={setEditCor}
                onEditAutoAssign={setEditAutoAssign} onEditMethod={setEditMethod} onEditMax={setEditMax}
                availableAgents={initialAgents} editAgentIds={editAgentIds} onEditAgentIds={setEditAgentIds}
                queueAgentIds={queueAgents[f.id] ?? []}
                saving={saving === f.id} deleting={deleting === f.id}
                onStartEdit={() => startEdit(f)} onSaveEdit={() => void saveEdit(f.id)} onCancelEdit={() => setEditingId(null)}
                onToggle={() => void toggleAtivo(f)} onDelete={() => void deleteFila(f)}
                onToggleAutoAssign={() => void toggleAutoAssign(f)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── FilaRow ───────────────────────────────────────────────────────────────────

function FilaRow({ fila, editing,
  editNome, editCor, editAutoAssign, editMethod, editMax,
  onEditNome, onEditCor, onEditAutoAssign, onEditMethod, onEditMax,
  availableAgents, editAgentIds, onEditAgentIds, queueAgentIds,
  saving, deleting, onStartEdit, onSaveEdit, onCancelEdit, onToggle, onDelete, onToggleAutoAssign,
}: {
  fila: Fila; editing: boolean
  editNome: string; editCor: string; editAutoAssign: boolean; editMethod: string; editMax: number
  onEditNome: (v: string) => void; onEditCor: (v: string) => void
  onEditAutoAssign: (v: boolean) => void; onEditMethod: (v: string) => void; onEditMax: (v: number) => void
  availableAgents: Agent[]; editAgentIds: string[]; onEditAgentIds: (ids: string[]) => void
  queueAgentIds: string[]
  saving: boolean; deleting: boolean
  onStartEdit: () => void; onSaveEdit: () => void; onCancelEdit: () => void
  onToggle: () => void; onDelete: () => void; onToggleAutoAssign: () => void
}) {
  function toggleAgent(id: string) {
    onEditAgentIds(
      editAgentIds.includes(id)
        ? editAgentIds.filter(a => a !== id)
        : [...editAgentIds, id]
    )
  }

  // Names of pinned agents in view mode
  const pinnedNames = queueAgentIds.length > 0
    ? availableAgents.filter(a => queueAgentIds.includes(a.id)).map(a => displayName(a))
    : []

  return (
    <div style={{ background: '#fff', border: `1.5px solid ${fila.ativo ? '#F1F4F7' : '#F8FAFB'}`, borderRadius: 11, overflow: 'hidden', opacity: fila.ativo ? 1 : 0.6 }}>
      {editing ? (
        <div style={{ padding: '14px 16px' }}>
          {/* Nome + Cor */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={labelStyle}>Nome</label>
              <input value={editNome} onChange={e => onEditNome(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit() }}
                style={inputStyle} autoFocus />
            </div>
            <ColorPicker value={editCor} onChange={onEditCor} />
          </div>

          {/* Distribuição */}
          <div style={{ background: '#F8FAFB', borderRadius: 9, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: editAutoAssign ? 12 : 0 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#0E2C3D', margin: 0 }}>Distribuição automática</p>
                <p style={{ fontSize: 11, color: '#8FA0AF', margin: '2px 0 0' }}>Atribui agentes automaticamente ao mover para esta fila</p>
              </div>
              <Toggle checked={editAutoAssign} onChange={onEditAutoAssign} />
            </div>
            {editAutoAssign && (
              <>
                <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={labelStyle}>Método</label>
                    <select value={editMethod} onChange={e => onEditMethod(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                      <option value="round_robin">Round-robin (reveza)</option>
                      <option value="least_loaded">Menor carga</option>
                    </select>
                  </div>
                  <div style={{ width: 90 }}>
                    <label style={labelStyle}>Máx/agente</label>
                    <input type="number" min={1} max={100} value={editMax} onChange={e => onEditMax(Number(e.target.value))} style={inputStyle} />
                  </div>
                </div>

                {/* Agent picker */}
                {availableAgents.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <label style={labelStyle}>Agentes desta fila</label>
                    <p style={{ fontSize: 11, color: '#8FA0AF', margin: '0 0 8px' }}>
                      {editAgentIds.length === 0 ? 'Nenhum selecionado — todos os atendentes são elegíveis' : `${editAgentIds.length} selecionado(s)`}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {availableAgents.map(a => {
                        const selected = editAgentIds.includes(a.id)
                        return (
                          <button key={a.id} onClick={() => toggleAgent(a.id)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                              border: `1.5px solid ${selected ? '#0098DA' : '#E8EDF2'}`,
                              borderRadius: 8, background: selected ? '#F0F8FF' : '#fff',
                              cursor: 'pointer', textAlign: 'left',
                            }}>
                            <span style={{
                              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                              border: `2px solid ${selected ? '#0098DA' : '#D1D9E0'}`,
                              background: selected ? '#0098DA' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {selected && <svg width="10" height="10" fill="none" stroke="#fff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: selected ? 600 : 400, color: selected ? '#0E2C3D' : '#5A7184' }}>
                              {displayName(a)}
                            </span>
                            {a.apelido && (
                              <span style={{ fontSize: 11, color: '#8FA0AF' }}>{a.full_name}</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onCancelEdit} style={{ padding: '7px 12px', fontSize: 11, border: '1px solid #E8EDF2', borderRadius: 7, cursor: 'pointer', background: '#fff', color: '#5A7184', fontWeight: 600 }}>Cancelar</button>
            <button onClick={onSaveEdit} disabled={saving}
              style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, border: 'none', borderRadius: 7, cursor: 'pointer', background: '#0098DA', color: '#fff', opacity: saving ? 0.7 : 1 }}>
              {saving ? '...' : 'Salvar'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px' }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: fila.cor, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#0E2C3D' }}>{fila.nome}</span>
            {fila.auto_assign && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: '#E8F5FD', color: '#0086C2' }}>
                AUTO
              </span>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={onStartEdit} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, border: '1px solid #E8EDF2', borderRadius: 7, cursor: 'pointer', background: '#F8FAFB', color: '#5A7184' }}>Editar</button>
              <button onClick={onToggle} disabled={saving}
                style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, border: '1px solid #E8EDF2', borderRadius: 7, cursor: 'pointer', background: fila.ativo ? '#FFF8E1' : '#E8F7EE', color: fila.ativo ? '#92400E' : '#1D9E75', opacity: saving ? 0.6 : 1 }}>
                {fila.ativo ? 'Desativar' : 'Reativar'}
              </button>
              <button onClick={onDelete} disabled={deleting}
                style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, border: '1px solid #FECACA', borderRadius: 7, cursor: 'pointer', background: '#FEF2F2', color: '#DC2626', opacity: deleting ? 0.6 : 1 }}>
                {deleting ? '...' : 'Deletar'}
              </button>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #F1F4F7', padding: '10px 16px', background: '#FAFCFD' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Toggle checked={fila.auto_assign ?? false} onChange={onToggleAutoAssign} disabled={saving} />
              <span style={{ fontSize: 12, color: '#5A7184', fontWeight: 500 }}>Distribuição automática</span>
              {fila.auto_assign && (
                <span style={{ fontSize: 11, color: '#8FA0AF' }}>
                  {fila.distribution_method === 'round_robin' ? 'Round-robin' : 'Menor carga'} · máx {fila.max_per_agent ?? 10}/agente
                </span>
              )}
            </div>
            {/* Pinned agents */}
            {pinnedNames.length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                {pinnedNames.map(name => (
                  <span key={name} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: '#F1F4F7', color: '#5A7184' }}>
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: 36, height: 20, borderRadius: 99, border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: checked ? '#0098DA' : '#D1D9E0', position: 'relative', flexShrink: 0,
        transition: 'background 0.2s', padding: 0, opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16,
        borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
      }} />
    </button>
  )
}

// ── ColorPicker ───────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div>
      <label style={labelStyle}>Cor</label>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxWidth: 180 }}>
        {PRESET_COLORS.map(c => (
          <button key={c} onClick={() => onChange(c)}
            style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: value === c ? '3px solid #0E2C3D' : '2px solid transparent', cursor: 'pointer', flexShrink: 0, outline: 'none', padding: 0 }} />
        ))}
      </div>
    </div>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5A7184', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 5 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 11px', fontSize: 13, border: '1px solid #E8EDF2', borderRadius: 9, outline: 'none', boxSizing: 'border-box', color: '#0E2C3D' }
