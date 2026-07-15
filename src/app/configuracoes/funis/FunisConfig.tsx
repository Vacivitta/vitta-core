'use client'

import { useState, useRef, useEffect } from 'react'
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { FunnelStage, FunnelWithStages } from '@/types/database'
import {
  listFunnels, createFunnel, updateFunnel, deactivateFunnel, deleteFunnel,
  createStage, updateStage, deleteStage, reorderStages,
} from '@/lib/funnels'

const PRESET_COLORS = [
  '#94a3b8','#60a5fa','#a78bfa','#f472b6',
  '#fb923c','#fbbf24','#34d399','#f87171',
  '#2dd4bf','#3E9849','#818cf8','#e879f9',
]

interface Props {
  initialFunnels:    FunnelWithStages[]
  initialLeadCounts: Record<string, number>
}

type ConfirmFunnelAction = { id: string; type: 'deactivate' | 'delete' }

export default function FunisConfig({ initialFunnels, initialLeadCounts }: Props) {
  const [funnels,    setFunnels]    = useState<FunnelWithStages[]>(initialFunnels)
  const [selectedId, setSelectedId] = useState<string>(initialFunnels[0]?.id ?? '')
  const [leadCounts, setLeadCounts] = useState(initialLeadCounts)
  const [busy,       setBusy]       = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Funnel editing
  const [editingFunnelId,  setEditingFunnelId]  = useState<string | null>(null)
  const [editFunnelName,   setEditFunnelName]   = useState('')
  const [newFunnelName,    setNewFunnelName]    = useState('')
  const [showNewFunnel,    setShowNewFunnel]    = useState(false)
  const [confirmAction,    setConfirmAction]    = useState<ConfirmFunnelAction | null>(null)

  // Stage editing
  const [editingStageId,       setEditingStageId]       = useState<string | null>(null)
  const [editStageName,        setEditStageName]        = useState('')
  const [colorPickerStageId,   setColorPickerStageId]   = useState<string | null>(null)
  const [confirmDeleteStageId, setConfirmDeleteStageId] = useState<string | null>(null)
  const [newStageName,         setNewStageName]         = useState('')

  const cpRef = useRef<HTMLDivElement>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const selectedFunnel = funnels.find(f => f.id === selectedId)

  // Count leads across all stages of a funnel
  const funnelLeadCount = (f: FunnelWithStages) =>
    f.stages.reduce((s, st) => s + (leadCounts[st.id] ?? 0), 0)

  async function reload() {
    const fresh = await listFunnels()
    setFunnels(fresh)
  }

  // Close color picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (cpRef.current && !cpRef.current.contains(e.target as Node))
        setColorPickerStageId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Funnel actions ──────────────────────────────────────────────────────────

  async function handleCreateFunnel() {
    if (!newFunnelName.trim()) return
    setBusy(true)
    try {
      const created = await createFunnel(newFunnelName.trim())
      setNewFunnelName('')
      setShowNewFunnel(false)
      await reload()
      setSelectedId(created.id)
    } finally { setBusy(false) }
  }

  async function handleSaveFunnelName(id: string) {
    if (!editFunnelName.trim()) { setEditingFunnelId(null); return }
    await updateFunnel(id, { nome: editFunnelName.trim() })
    setFunnels(prev => prev.map(f => f.id === id ? { ...f, nome: editFunnelName.trim() } : f))
    setEditingFunnelId(null)
  }

  async function handleDeactivate(id: string) {
    setBusy(true)
    try {
      await deactivateFunnel(id)
      await reload()
      if (selectedId === id) {
        const remaining = funnels.filter(f => f.id !== id && f.ativo)
        setSelectedId(remaining[0]?.id ?? '')
      }
      setConfirmAction(null)
    } finally { setBusy(false) }
  }

  async function handleDeleteFunnel(id: string) {
    setBusy(true)
    setDeleteError(null)
    try {
      const result = await deleteFunnel(id)
      if (!result.ok) {
        setDeleteError(`Este funil tem ${result.leadCount} lead${result.leadCount !== 1 ? 's' : ''} ativos. Mova ou arquive os leads antes de excluir.`)
        return
      }
      await reload()
      const remaining = funnels.filter(f => f.id !== id)
      setSelectedId(remaining[0]?.id ?? '')
      setConfirmAction(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setDeleteError(`Erro ao excluir funil: ${msg}`)
    } finally { setBusy(false) }
  }

  // ── Stage actions ───────────────────────────────────────────────────────────

  async function handleSaveStageName(stage: FunnelStage) {
    if (!editStageName.trim()) { setEditingStageId(null); return }
    await updateStage(stage.id, { nome: editStageName.trim() })
    setFunnels(prev => prev.map(f =>
      f.id === stage.funnel_id
        ? { ...f, stages: f.stages.map(s => s.id === stage.id ? { ...s, nome: editStageName.trim() } : s) }
        : f
    ))
    setEditingStageId(null)
  }

  async function handleAlertDaysChange(stage: FunnelStage, hours: number | null) {
    await updateStage(stage.id, { alerta_horas: hours })
    setFunnels(prev => prev.map(f =>
      f.id === stage.funnel_id
        ? { ...f, stages: f.stages.map(s => s.id === stage.id ? { ...s, alerta_horas: hours } : s) }
        : f
    ))
  }

  async function handleChangeColor(stage: FunnelStage, cor: string) {
    await updateStage(stage.id, { cor })
    setFunnels(prev => prev.map(f =>
      f.id === stage.funnel_id
        ? { ...f, stages: f.stages.map(s => s.id === stage.id ? { ...s, cor } : s) }
        : f
    ))
    setColorPickerStageId(null)
  }

  async function handleAddStage() {
    if (!newStageName.trim() || !selectedFunnel) return
    setBusy(true)
    try {
      const lastOrdem = selectedFunnel.stages.at(-1)?.ordem ?? -1
      const created = await createStage(selectedFunnel.id, newStageName.trim(), '#94a3b8', lastOrdem)
      setFunnels(prev => prev.map(f =>
        f.id === selectedFunnel.id ? { ...f, stages: [...f.stages, created] } : f
      ))
      setNewStageName('')
    } finally { setBusy(false) }
  }

  async function handleDeleteStage(stage: FunnelStage) {
    setBusy(true)
    try {
      await deleteStage(stage.id)
      setFunnels(prev => prev.map(f =>
        f.id === stage.funnel_id
          ? { ...f, stages: f.stages.filter(s => s.id !== stage.id) }
          : f
      ))
      setConfirmDeleteStageId(null)
    } finally { setBusy(false) }
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || !selectedFunnel) return
    const stages = selectedFunnel.stages
    const oldIndex = stages.findIndex(s => s.id === active.id)
    const newIndex = stages.findIndex(s => s.id === over.id)
    const reordered = arrayMove(stages, oldIndex, newIndex)
    setFunnels(prev => prev.map(f =>
      f.id === selectedFunnel.id ? { ...f, stages: reordered } : f
    ))
    await reorderStages(reordered.map(s => s.id))
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

      {/* Page header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #F1EFE5', padding: '18px 28px', flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#25402C', margin: 0, letterSpacing: '-0.02em' }}>Funis de Venda</h1>
        <p style={{ fontSize: 12, color: '#9AA79C', margin: '3px 0 0' }}>
          Configure etapas personalizadas para cada processo comercial
        </p>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left: funnel list ── */}
        <aside style={{ width: 280, minWidth: 280, borderRight: '1px solid #F1EFE5', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>

          {/* List header */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #F1EFE5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#9AA79C', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Funis</p>
            <button
              onClick={() => { setShowNewFunnel(true); setDeleteError(null) }}
              style={{ fontSize: 12, fontWeight: 700, color: '#3E9849', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
            >
              + Novo
            </button>
          </div>

          {/* New funnel form */}
          {showNewFunnel && (
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #E8F4E6', background: '#E8F4E6', flexShrink: 0 }}>
              <input
                autoFocus type="text" value={newFunnelName}
                onChange={e => setNewFunnelName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleCreateFunnel(); if (e.key === 'Escape') setShowNewFunnel(false) }}
                placeholder="Nome do funil..."
                style={{ width: '100%', fontSize: 13, border: '1px solid #B3DFFF', borderRadius: 8, padding: '7px 10px', outline: 'none', marginBottom: 8, boxSizing: 'border-box', background: '#fff' }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => void handleCreateFunnel()} disabled={busy || !newFunnelName.trim()}
                  style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 700, background: '#3E9849', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                  Criar
                </button>
                <button onClick={() => setShowNewFunnel(false)}
                  style={{ flex: 1, padding: '7px', fontSize: 12, border: '1px solid #EBE7DA', borderRadius: 8, cursor: 'pointer', background: '#fff', color: '#71856F' }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Funnel list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {funnels.map(funnel => {
              const isSelected = funnel.id === selectedId
              const totalLeads = funnelLeadCount(funnel)
              const isConfirming = confirmAction?.id === funnel.id
              return (
                <div key={funnel.id}>
                  <div
                    onClick={() => { setSelectedId(funnel.id); setConfirmAction(null); setDeleteError(null) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                      cursor: 'pointer', transition: 'background 0.1s',
                      background: isSelected ? '#E8F4E6' : 'transparent',
                      borderLeft: isSelected ? '3px solid #3E9849' : '3px solid transparent',
                    }}
                  >
                    {/* Dot */}
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: funnel.ativo ? '#1D9E75' : '#D1D5DB', flexShrink: 0 }} />

                    {/* Name / inline edit */}
                    {editingFunnelId === funnel.id ? (
                      <input
                        autoFocus value={editFunnelName}
                        onChange={e => setEditFunnelName(e.target.value)}
                        onBlur={() => void handleSaveFunnelName(funnel.id)}
                        onKeyDown={e => { if (e.key === 'Enter') void handleSaveFunnelName(funnel.id); if (e.key === 'Escape') setEditingFunnelId(null) }}
                        onClick={e => e.stopPropagation()}
                        style={{ flex: 1, fontSize: 13, border: '1px solid #3E9849', borderRadius: 6, padding: '2px 6px', outline: 'none' }}
                      />
                    ) : (
                      <span style={{ flex: 1, fontSize: 13, fontWeight: isSelected ? 700 : 500, color: isSelected ? '#25402C' : '#71856F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {funnel.nome}
                      </span>
                    )}

                    {/* Meta */}
                    <span style={{ fontSize: 10, color: '#9AA79C', flexShrink: 0 }}>{funnel.stages.length} et.</span>
                    {!funnel.ativo && (
                      <span style={{ fontSize: 9, fontWeight: 700, background: '#F1EFE5', color: '#9AA79C', borderRadius: 99, padding: '2px 6px', flexShrink: 0 }}>INATIVO</span>
                    )}

                    {/* Actions (hover) — use a nested group */}
                    <div className="funnel-actions" style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditingFunnelId(funnel.id); setEditFunnelName(funnel.nome) }} title="Renomear"
                        style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#9AA79C', borderRadius: 6, lineHeight: 0 }}>
                        <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      {funnel.ativo && (
                        <button onClick={() => { setConfirmAction({ id: funnel.id, type: 'deactivate' }); setDeleteError(null) }} title="Desativar"
                          style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#9AA79C', borderRadius: 6, lineHeight: 0 }}>
                          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                          </svg>
                        </button>
                      )}
                      <button onClick={() => { setConfirmAction({ id: funnel.id, type: 'delete' }); setDeleteError(null) }} title="Excluir permanentemente"
                        style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#9AA79C', borderRadius: 6, lineHeight: 0 }}>
                        <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Confirm panel */}
                  {isConfirming && (
                    <div style={{ margin: '0 12px 8px', padding: '12px 14px', background: confirmAction!.type === 'delete' ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${confirmAction!.type === 'delete' ? '#FECACA' : '#FDE68A'}`, borderRadius: 10, fontSize: 12 }}>
                      {deleteError ? (
                        <p style={{ color: '#DC2626', margin: '0 0 8px', lineHeight: 1.4 }}>{deleteError}</p>
                      ) : confirmAction!.type === 'delete' ? (
                        <>
                          <p style={{ fontWeight: 700, color: '#DC2626', margin: '0 0 2px' }}>Excluir "{funnel.nome}" permanentemente?</p>
                          <p style={{ color: '#EF4444', margin: '0 0 8px', lineHeight: 1.4 }}>
                            {totalLeads > 0
                              ? `Este funil tem ${totalLeads} lead${totalLeads !== 1 ? 's' : ''} ativos — mova-os antes de excluir.`
                              : 'Todas as etapas serão removidas. Não pode ser desfeito.'}
                          </p>
                        </>
                      ) : (
                        <>
                          <p style={{ fontWeight: 700, color: '#92400E', margin: '0 0 2px' }}>Desativar "{funnel.nome}"?</p>
                          <p style={{ color: '#B45309', margin: '0 0 8px', lineHeight: 1.4 }}>O funil ficará oculto. Leads preservados.</p>
                        </>
                      )}
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!(deleteError) && !(confirmAction!.type === 'delete' && totalLeads > 0) && (
                          <button disabled={busy}
                            onClick={() => confirmAction!.type === 'delete' ? void handleDeleteFunnel(funnel.id) : void handleDeactivate(funnel.id)}
                            style={{ flex: 1, padding: '6px', fontSize: 11, fontWeight: 700, background: confirmAction!.type === 'delete' ? '#EF4444' : '#F59E0B', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                            {busy ? '...' : confirmAction!.type === 'delete' ? 'Excluir' : 'Desativar'}
                          </button>
                        )}
                        <button onClick={() => { setConfirmAction(null); setDeleteError(null) }}
                          style={{ flex: 1, padding: '6px', fontSize: 11, border: '1px solid #EBE7DA', borderRadius: 7, cursor: 'pointer', background: '#fff', color: '#71856F' }}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </aside>

        {/* ── Right: stages ── */}
        <main style={{ flex: 1, overflowY: 'auto', padding: 28, background: '#FBFAF4' }}>
          {!selectedFunnel ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9AA79C', fontSize: 13 }}>
              Selecione um funil para configurar as etapas
            </div>
          ) : (
            <div style={{ maxWidth: 580 }}>

              {/* Funnel header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 800, color: '#25402C', margin: 0 }}>{selectedFunnel.nome}</h2>
                  <p style={{ fontSize: 12, color: '#9AA79C', margin: '2px 0 0' }}>
                    {selectedFunnel.stages.length} etapas · arraste para reordenar
                  </p>
                </div>
                <span style={{
                  marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                  background: selectedFunnel.ativo ? '#E8F7EE' : '#F1EFE5',
                  color:      selectedFunnel.ativo ? '#1D9E75'  : '#9AA79C',
                }}>
                  {selectedFunnel.ativo ? 'Ativo' : 'Inativo'}
                </span>
              </div>

              {/* Stages */}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={selectedFunnel.stages.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }} ref={cpRef}>
                    {selectedFunnel.stages.map(stage => {
                      const leadCount = leadCounts[stage.id] ?? 0
                      return (
                        <SortableStageRow
                          key={stage.id}
                          stage={stage}
                          leadCount={leadCount}
                          isEditingName={editingStageId === stage.id}
                          editNameValue={editStageName}
                          onEditNameChange={setEditStageName}
                          onEditNameStart={() => { setEditingStageId(stage.id); setEditStageName(stage.nome) }}
                          onEditNameSave={() => void handleSaveStageName(stage)}
                          onEditNameCancel={() => setEditingStageId(null)}
                          showColorPicker={colorPickerStageId === stage.id}
                          onColorPickerToggle={() => setColorPickerStageId(colorPickerStageId === stage.id ? null : stage.id)}
                          onColorChange={cor => void handleChangeColor(stage, cor)}
                          onAlertHoursChange={h => void handleAlertDaysChange(stage, h)}
                          onDeleteRequest={() => setConfirmDeleteStageId(stage.id)}
                          confirmDelete={confirmDeleteStageId === stage.id}
                          onDeleteConfirm={() => void handleDeleteStage(stage)}
                          onDeleteCancel={() => setConfirmDeleteStageId(null)}
                          busy={busy}
                        />
                      )
                    })}
                  </div>
                </SortableContext>
              </DndContext>

              {/* Add stage */}
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text" value={newStageName}
                  onChange={e => setNewStageName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleAddStage() }}
                  placeholder="Nome da nova etapa..."
                  style={{ flex: 1, fontSize: 13, border: '1px solid #EBE7DA', borderRadius: 10, padding: '9px 12px', outline: 'none', background: '#fff' }}
                />
                <button
                  onClick={() => void handleAddStage()}
                  disabled={busy || !newStageName.trim()}
                  style={{ padding: '9px 18px', fontSize: 13, fontWeight: 700, background: '#3E9849', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', opacity: busy || !newStageName.trim() ? 0.5 : 1, transition: 'opacity 0.15s' }}
                >
                  + Adicionar
                </button>
              </div>

              {selectedFunnel.stages.length > 1 && (
                <p style={{ fontSize: 11, color: '#9AA79C', marginTop: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Arraste pelo ícone ⠿ para reordenar as etapas
                </p>
              )}
            </div>
          )}
        </main>
      </div>

      <style>{`
        .funnel-actions { opacity: 0; transition: opacity 0.15s; }
        div:hover > .funnel-actions { opacity: 1; }
      `}</style>
    </div>
  )
}

// ── SortableStageRow ──────────────────────────────────────────────────────────

interface StageRowProps {
  stage:              FunnelStage
  leadCount:          number
  isEditingName:      boolean
  editNameValue:      string
  onEditNameChange:   (v: string) => void
  onEditNameStart:    () => void
  onEditNameSave:     () => void
  onEditNameCancel:   () => void
  showColorPicker:    boolean
  onColorPickerToggle:() => void
  onColorChange:      (cor: string) => void
  onAlertHoursChange: (h: number | null) => void
  onDeleteRequest:    () => void
  confirmDelete:      boolean
  onDeleteConfirm:    () => void
  onDeleteCancel:     () => void
  busy:               boolean
}

function SortableStageRow({
  stage, leadCount,
  isEditingName, editNameValue, onEditNameChange, onEditNameStart, onEditNameSave, onEditNameCancel,
  showColorPicker, onColorPickerToggle, onColorChange,
  onAlertHoursChange,
  onDeleteRequest, confirmDelete, onDeleteConfirm, onDeleteCancel,
  busy,
}: StageRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id })
  const [alertInput, setAlertInput] = useState(stage.alerta_horas?.toString() ?? '')

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{ background: '#fff', border: '1px solid #F1EFE5', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>

        {/* Drag handle */}
        <button {...attributes} {...listeners} tabIndex={-1}
          style={{ background: 'none', border: 'none', cursor: 'grab', color: '#D1D5DB', padding: 0, lineHeight: 0, flexShrink: 0, touchAction: 'none' }}>
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8-16a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
          </svg>
        </button>

        {/* Color swatch */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={onColorPickerToggle} title="Mudar cor"
            style={{ width: 22, height: 22, borderRadius: '50%', background: stage.cor, border: '2px solid #fff', boxShadow: '0 0 0 1px #EBE7DA', cursor: 'pointer', transition: 'transform 0.15s' }}
          />
          {showColorPicker && (
            <div style={{ position: 'absolute', left: 0, top: 28, zIndex: 20, background: '#fff', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.12)', border: '1px solid #F1EFE5', padding: 10, display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6, width: 172 }}>
              {PRESET_COLORS.map(cor => (
                <button key={cor} onClick={() => onColorChange(cor)}
                  style={{ width: 22, height: 22, borderRadius: '50%', background: cor, border: stage.cor === cor ? '2px solid #3E9849' : '2px solid #fff', boxShadow: '0 0 0 1px #EBE7DA', cursor: 'pointer', transition: 'transform 0.1s' }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Name */}
        {isEditingName ? (
          <input autoFocus value={editNameValue} onChange={e => onEditNameChange(e.target.value)}
            onBlur={onEditNameSave}
            onKeyDown={e => { if (e.key === 'Enter') onEditNameSave(); if (e.key === 'Escape') onEditNameCancel() }}
            style={{ flex: 1, fontSize: 13, border: '1px solid #3E9849', borderRadius: 7, padding: '3px 8px', outline: 'none' }}
          />
        ) : (
          <button onClick={onEditNameStart} title="Renomear"
            style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: 600, color: '#25402C', background: 'none', border: 'none', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {stage.nome}
          </button>
        )}

        {/* Lead count badge */}
        {leadCount > 0 && (
          <span style={{ fontSize: 10, fontWeight: 600, background: '#F1EFE5', color: '#71856F', borderRadius: 99, padding: '2px 8px', flexShrink: 0 }}>
            {leadCount} lead{leadCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* Alert hours */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="Alerta após X horas nesta etapa (vazio = desligado)">
          <svg width="12" height="12" fill="none" stroke="#D1D5DB" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <input type="number" min="1" value={alertInput} placeholder="∞"
            onChange={e => setAlertInput(e.target.value)}
            onBlur={() => {
              const h = alertInput.trim() ? parseInt(alertInput, 10) : null
              const valid = h && h > 0 ? h : null
              if (valid !== stage.alerta_horas) onAlertHoursChange(valid)
              setAlertInput(valid?.toString() ?? '')
            }}
            style={{ width: 38, textAlign: 'center', fontSize: 11, border: '1px solid #EBE7DA', borderRadius: 6, padding: '3px 4px', outline: 'none', color: '#71856F' }}
          />
        </div>

        {/* Delete */}
        {leadCount > 0 ? (
          <span title="Mova os leads antes de excluir" style={{ padding: 4, color: '#EBE7DA', lineHeight: 0, flexShrink: 0 }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </span>
        ) : (
          <button onClick={onDeleteRequest} title="Excluir etapa"
            style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#D1D5DB', borderRadius: 6, lineHeight: 0, flexShrink: 0, transition: 'color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#D1D5DB')}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {/* Delete confirm */}
      {confirmDelete && (
        <div style={{ margin: '4px 0 0', padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 12 }}>
          <p style={{ fontWeight: 700, color: '#DC2626', margin: '0 0 2px' }}>Excluir etapa "{stage.nome}"?</p>
          <p style={{ color: '#EF4444', margin: '0 0 8px' }}>Esta ação não pode ser desfeita.</p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onDeleteConfirm} disabled={busy}
              style={{ flex: 1, padding: '6px', fontSize: 11, fontWeight: 700, background: '#EF4444', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
              Excluir
            </button>
            <button onClick={onDeleteCancel}
              style={{ flex: 1, padding: '6px', fontSize: 11, border: '1px solid #EBE7DA', borderRadius: 7, cursor: 'pointer', background: '#fff', color: '#71856F' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
