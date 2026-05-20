'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { FunnelStage, FunnelWithStages } from '@/types/database'
import {
  listFunnels, createFunnel, updateFunnel, deactivateFunnel,
  createStage, updateStage, deleteStage, reorderStages,
} from '@/lib/funnels'

const PRESET_COLORS = [
  '#94a3b8', '#60a5fa', '#a78bfa', '#f472b6',
  '#fb923c', '#fbbf24', '#34d399', '#f87171',
  '#2dd4bf', '#6ee7b7', '#818cf8', '#e879f9',
]

interface Props {
  initialFunnels: FunnelWithStages[]
  initialLeadCounts: Record<string, number>
}

export default function FunisConfig({ initialFunnels, initialLeadCounts }: Props) {
  const [funnels, setFunnels]           = useState<FunnelWithStages[]>(initialFunnels)
  const [selectedId, setSelectedId]     = useState<string>(initialFunnels[0]?.id ?? '')
  const [leadCounts, setLeadCounts]     = useState(initialLeadCounts)
  const [busy, setBusy] = useState(false)

  // Funnel editing
  const [editingFunnelId, setEditingFunnelId]   = useState<string | null>(null)
  const [editFunnelName, setEditFunnelName]     = useState('')
  const [newFunnelName, setNewFunnelName]       = useState('')
  const [showNewFunnel, setShowNewFunnel]       = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null)

  // Stage editing
  const [editingStageId, setEditingStageId]   = useState<string | null>(null)
  const [editStageName, setEditStageName]     = useState('')
  const [colorPickerStageId, setColorPickerStageId] = useState<string | null>(null)
  const [confirmDeleteStageId, setConfirmDeleteStageId] = useState<string | null>(null)
  const [newStageName, setNewStageName]       = useState('')

  const selectedFunnel = funnels.find(f => f.id === selectedId)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  async function reload() {
    const fresh = await listFunnels()
    setFunnels(fresh)
  }

  // ---- Funnel actions -------------------------------------------------------

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
      setConfirmDeactivate(null)
    } finally { setBusy(false) }
  }

  // ---- Stage actions -------------------------------------------------------

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

  async function handleAlertDaysChange(stage: FunnelStage, days: number | null) {
    await updateStage(stage.id, { alerta_horas: days })
    setFunnels(prev => prev.map(f =>
      f.id === stage.funnel_id
        ? { ...f, stages: f.stages.map(s => s.id === stage.id ? { ...s, alerta_dias: days } : s) }
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

    // Atualiza UI imediatamente (otimista)
    setFunnels(prev => prev.map(f =>
      f.id === selectedFunnel.id ? { ...f, stages: reordered } : f
    ))

    // Persiste (dois passos para contornar UNIQUE constraint)
    await reorderStages(reordered.map(s => s.id))
  }

  // Fecha color picker ao clicar fora
  const cpRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (cpRef.current && !cpRef.current.contains(e.target as Node)) {
        setColorPickerStageId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <Link
          href="/funil"
          className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1.5 transition-colors"
          title="Voltar ao funil"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-base font-bold text-gray-900">Configurar Funis</h1>
          <p className="text-xs text-gray-400">Crie etapas personalizadas para cada processo comercial</p>
        </div>
      </header>

      <div className="flex h-[calc(100vh-61px)]">
        {/* ---- Painel esquerdo: lista de funis ---- */}
        <aside className="w-72 bg-white border-r border-gray-200 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Funis</span>
            <button
              onClick={() => setShowNewFunnel(true)}
              className="text-xs text-blue-500 hover:text-blue-700 font-medium transition-colors"
            >
              + Novo
            </button>
          </div>

          {/* Formulário novo funil */}
          {showNewFunnel && (
            <div className="px-4 py-3 border-b border-blue-100 bg-blue-50">
              <input
                autoFocus
                type="text"
                value={newFunnelName}
                onChange={e => setNewFunnelName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateFunnel(); if (e.key === 'Escape') setShowNewFunnel(false) }}
                placeholder="Nome do funil..."
                className="w-full text-sm border border-blue-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
              />
              <div className="flex gap-2">
                <button onClick={handleCreateFunnel} disabled={busy || !newFunnelName.trim()} className="flex-1 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 font-medium">
                  Criar
                </button>
                <button onClick={() => setShowNewFunnel(false)} className="flex-1 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Lista */}
          <div className="flex-1 overflow-y-auto py-2">
            {funnels.map(funnel => (
              <div key={funnel.id}>
                <div
                  className={`group flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors ${
                    selectedId === funnel.id ? 'bg-blue-50 border-r-2 border-blue-500' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedId(funnel.id)}
                >
                  {/* Nome / edição inline */}
                  {editingFunnelId === funnel.id ? (
                    <input
                      autoFocus
                      value={editFunnelName}
                      onChange={e => setEditFunnelName(e.target.value)}
                      onBlur={() => handleSaveFunnelName(funnel.id)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveFunnelName(funnel.id); if (e.key === 'Escape') setEditingFunnelId(null) }}
                      className="flex-1 text-sm border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="flex-1 text-sm text-gray-800 truncate">{funnel.nome}</span>
                  )}

                  {/* Badge inativo */}
                  {!funnel.ativo && (
                    <span className="text-[10px] bg-gray-100 text-gray-400 rounded-full px-1.5 py-0.5">inativo</span>
                  )}

                  {/* Contagem de etapas */}
                  <span className="text-[11px] text-gray-400">{funnel.stages.length} etapas</span>

                  {/* Ações (visíveis no hover) */}
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => { setEditingFunnelId(funnel.id); setEditFunnelName(funnel.nome) }}
                      className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 transition-colors"
                      title="Renomear"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    {funnel.ativo && (
                      <button
                        onClick={() => setConfirmDeactivate(funnel.id)}
                        className="p-1 text-gray-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors"
                        title="Desativar funil"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Confirmação de desativação */}
                {confirmDeactivate === funnel.id && (
                  <div className="mx-4 mb-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs">
                    <p className="text-red-700 font-medium mb-1">Desativar "{funnel.nome}"?</p>
                    <p className="text-red-500 mb-2">O funil ficará oculto. Os leads existentes são preservados.</p>
                    <div className="flex gap-2">
                      <button onClick={() => handleDeactivate(funnel.id)} disabled={busy} className="flex-1 py-1 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 disabled:opacity-50">
                        Desativar
                      </button>
                      <button onClick={() => setConfirmDeactivate(null)} className="flex-1 py-1 border border-gray-200 rounded-lg text-xs hover:bg-gray-50">
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* ---- Painel direito: etapas do funil selecionado ---- */}
        <main className="flex-1 overflow-y-auto p-6">
          {!selectedFunnel ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Selecione um funil para configurar suas etapas
            </div>
          ) : (
            <div className="max-w-xl">
              {/* Cabeçalho do funil */}
              <div className="flex items-center gap-3 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{selectedFunnel.nome}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {selectedFunnel.stages.length} etapas · arraste para reordenar
                  </p>
                </div>
                <div className={`ml-auto text-xs px-2.5 py-1 rounded-full font-medium ${
                  selectedFunnel.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {selectedFunnel.ativo ? 'ativo' : 'inativo'}
                </div>
              </div>

              {/* Lista de etapas com DnD */}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={selectedFunnel.stages.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2 mb-4" ref={cpRef}>
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
                          onEditNameSave={() => handleSaveStageName(stage)}
                          onEditNameCancel={() => setEditingStageId(null)}
                          showColorPicker={colorPickerStageId === stage.id}
                          onColorPickerToggle={() => setColorPickerStageId(colorPickerStageId === stage.id ? null : stage.id)}
                          onColorChange={cor => handleChangeColor(stage, cor)}
                          onAlertDaysChange={days => handleAlertDaysChange(stage, days)}
                          onDeleteRequest={() => setConfirmDeleteStageId(stage.id)}
                          confirmDelete={confirmDeleteStageId === stage.id}
                          onDeleteConfirm={() => handleDeleteStage(stage)}
                          onDeleteCancel={() => setConfirmDeleteStageId(null)}
                          busy={busy}
                        />
                      )
                    })}
                  </div>
                </SortableContext>
              </DndContext>

              {/* Adicionar etapa */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newStageName}
                  onChange={e => setNewStageName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddStage() }}
                  placeholder="Nome da nova etapa..."
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleAddStage}
                  disabled={busy || !newStageName.trim()}
                  className="px-4 py-2.5 bg-blue-500 text-white text-sm font-medium rounded-xl hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  Adicionar
                </button>
              </div>

              {/* Dica de reordenação */}
              {selectedFunnel.stages.length > 1 && (
                <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Arraste pelo ícone <span className="font-mono">⠿</span> para reordenar as etapas
                </p>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

// ---- Componente de linha de etapa (sortable) --------------------------------

interface StageRowProps {
  stage: FunnelStage
  leadCount: number
  isEditingName: boolean
  editNameValue: string
  onEditNameChange: (v: string) => void
  onEditNameStart: () => void
  onEditNameSave: () => void
  onEditNameCancel: () => void
  showColorPicker: boolean
  onColorPickerToggle: () => void
  onColorChange: (cor: string) => void
  onAlertDaysChange: (days: number | null) => void
  onDeleteRequest: () => void
  confirmDelete: boolean
  onDeleteConfirm: () => void
  onDeleteCancel: () => void
  busy: boolean
}

function SortableStageRow({
  stage, leadCount,
  isEditingName, editNameValue, onEditNameChange, onEditNameStart, onEditNameSave, onEditNameCancel,
  showColorPicker, onColorPickerToggle, onColorChange,
  onAlertDaysChange,
  onDeleteRequest, confirmDelete, onDeleteConfirm, onDeleteCancel,
  busy,
}: StageRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id })
  const [alertInput, setAlertInput] = useState(stage.alerta_horas?.toString() ?? '')

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'opacity-50' : ''}>
      <div className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-3 hover:border-gray-300 transition-colors">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none shrink-0"
          tabIndex={-1}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8-16a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
          </svg>
        </button>

        {/* Seletor de cor */}
        <div className="relative shrink-0">
          <button
            onClick={onColorPickerToggle}
            className="w-6 h-6 rounded-full border-2 border-white shadow-sm hover:scale-110 transition-transform ring-1 ring-gray-200"
            style={{ backgroundColor: stage.cor }}
            title="Mudar cor"
          />
          {showColorPicker && (
            <div className="absolute left-0 top-8 z-10 bg-white rounded-xl shadow-xl border border-gray-200 p-2 grid grid-cols-6 gap-1.5 w-44">
              {PRESET_COLORS.map(cor => (
                <button
                  key={cor}
                  onClick={() => onColorChange(cor)}
                  className={`w-6 h-6 rounded-full hover:scale-110 transition-transform ring-offset-1 ${
                    stage.cor === cor ? 'ring-2 ring-blue-500' : 'ring-1 ring-gray-200'
                  }`}
                  style={{ backgroundColor: cor }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Nome / edição inline */}
        {isEditingName ? (
          <input
            autoFocus
            value={editNameValue}
            onChange={e => onEditNameChange(e.target.value)}
            onBlur={onEditNameSave}
            onKeyDown={e => { if (e.key === 'Enter') onEditNameSave(); if (e.key === 'Escape') onEditNameCancel() }}
            className="flex-1 text-sm border border-blue-300 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        ) : (
          <button
            onClick={onEditNameStart}
            className="flex-1 text-left text-sm text-gray-800 hover:text-blue-600 transition-colors font-medium truncate"
            title="Clique para renomear"
          >
            {stage.nome}
          </button>
        )}

        {/* Badge de leads */}
        {leadCount > 0 && (
          <span className="text-[11px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 shrink-0">
            {leadCount} lead{leadCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* Alerta de permanência */}
        <div className="flex items-center gap-1 shrink-0" title="Alerta: horas máximas na etapa (deixe vazio para desativar)">
          <svg className="w-3 h-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <input
            type="number"
            min="1"
            value={alertInput}
            onChange={e => setAlertInput(e.target.value)}
            onBlur={() => {
              const days = alertInput.trim() ? parseInt(alertInput, 10) : null
              const valid = days && days > 0 ? days : null
              if (valid !== stage.alerta_horas) onAlertDaysChange(valid)
              setAlertInput(valid?.toString() ?? '')
            }}
            placeholder="∞"
            className="w-10 text-center text-xs border border-gray-200 rounded-lg py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-600 placeholder:text-gray-300"
          />
        </div>

        {/* Botão excluir */}
        {leadCount > 0 ? (
          <span
            className="shrink-0 p-1 text-gray-200 cursor-not-allowed"
            title={`${leadCount} lead${leadCount !== 1 ? 's' : ''} nesta etapa — mova os leads antes de excluir`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </span>
        ) : (
          <button
            onClick={onDeleteRequest}
            className="shrink-0 p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
            title="Excluir etapa"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {/* Confirmação de exclusão */}
      {confirmDelete && (
        <div className="mt-1 p-3 bg-red-50 border border-red-200 rounded-xl text-xs">
          <p className="text-red-700 font-medium mb-1">Excluir etapa "{stage.nome}"?</p>
          <p className="text-red-500 mb-2">Esta ação não pode ser desfeita.</p>
          <div className="flex gap-2">
            <button onClick={onDeleteConfirm} disabled={busy} className="flex-1 py-1 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 disabled:opacity-50">
              Excluir
            </button>
            <button onClick={onDeleteCancel} className="flex-1 py-1 border border-gray-200 rounded-lg text-xs hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
