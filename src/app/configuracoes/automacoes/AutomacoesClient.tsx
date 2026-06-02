'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile, AutomationTrigger } from '@/types/database'
import { QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS } from '@/types/database'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Stage {
  id:        string
  nome:      string
  cor:       string
  funnel_id: string
  funnels:   { nome: string } | null
}

interface Automation {
  id:           string
  unit_id:      string
  quote_status: AutomationTrigger
  action:       'move_stage' | 'archive' | 'none'
  stage_id:     string | null
  ativo:        boolean
}

interface Props {
  currentUser:        Profile
  stages:             Stage[]
  initialAutomations: Automation[]
}

const AUTOMATABLE: AutomationTrigger[] = ['criado', 'enviado', 'aceito', 'recusado']

const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  criado:        'Orçamento Criado',
  enviado:       'Enviado ao Paciente',
  visualizado:   'Visualizado',
  aceito:        'Aceito',
  recusado:      'Recusado',
  em_negociacao: 'Em Negociação',
  expirado:      'Expirado',
  rascunho:      'Rascunho',
}

const TRIGGER_COLORS: Record<AutomationTrigger, string> = {
  criado:        'bg-purple-100 text-purple-700',
  enviado:       QUOTE_STATUS_COLORS.enviado,
  visualizado:   QUOTE_STATUS_COLORS.visualizado,
  aceito:        QUOTE_STATUS_COLORS.aceito,
  recusado:      QUOTE_STATUS_COLORS.recusado,
  em_negociacao: QUOTE_STATUS_COLORS.em_negociacao,
  expirado:      QUOTE_STATUS_COLORS.expirado,
  rascunho:      QUOTE_STATUS_COLORS.rascunho,
}

const STATUS_DESCRIPTIONS: Record<string, string> = {
  criado:   'Quando um orçamento é criado para o lead',
  enviado:  'Quando o link do orçamento é copiado/enviado ao paciente',
  aceito:   'Quando o paciente aceita o orçamento',
  recusado: 'Quando o paciente recusa o orçamento',
}

const STATUS_ICONS: Record<string, string> = {
  criado:   '📋',
  enviado:  '📤',
  aceito:   '✅',
  recusado: '❌',
}

type Action = 'none' | 'move_stage' | 'archive'

interface RowState {
  action:   Action
  stage_id: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AutomacoesClient({ currentUser, stages, initialAutomations }: Props) {
  const supabase = createClient()
  const unitId   = currentUser.unit_id

  // Build initial row states from existing automations
  const initRows = (): Record<AutomationTrigger, RowState> => {
    const defaults: Record<string, RowState> = {}
    for (const s of AUTOMATABLE) {
      const existing = initialAutomations.find(a => a.quote_status === s)
      defaults[s] = {
        action:   existing?.action   ?? 'none',
        stage_id: existing?.stage_id ?? '',
      }
    }
    return defaults as Record<AutomationTrigger, RowState>
  }

  const [rows,    setRows]    = useState<Record<AutomationTrigger, RowState>>(initRows)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  function setRow(status: AutomationTrigger, patch: Partial<RowState>) {
    setRows(prev => ({ ...prev, [status]: { ...prev[status], ...patch } }))
    setSaved(false)
  }

  async function handleSave() {
    if (!unitId) { setError('Perfil sem unidade configurada.'); return }
    setSaving(true)
    setError('')

    for (const status of AUTOMATABLE) {
      const row = rows[status]
      const existing = initialAutomations.find(a => a.quote_status === status)

      const payload = {
        unit_id:      unitId,
        quote_status: status,
        action:       row.action,
        stage_id:     row.action === 'move_stage' && row.stage_id ? row.stage_id : null,
        ativo:        true,
      }

      if (existing) {
        await supabase.from('quote_automations').update(payload).eq('id', existing.id)
      } else {
        await supabase.from('quote_automations').insert(payload)
      }
    }

    setSaving(false)
    setSaved(true)
  }

  // Group stages by funnel for the dropdown
  const stagesByFunnel = stages.reduce<Record<string, { funnel: string; stages: Stage[] }>>(
    (acc, s) => {
      const fn = s.funnel_id
      if (!acc[fn]) acc[fn] = { funnel: s.funnels?.nome ?? 'Funil', stages: [] }
      acc[fn].stages.push(s)
      return acc
    },
    {}
  )

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Automações de Funil</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Configure o que acontece com o lead no funil quando o status de um orçamento muda
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-xl hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {saving && (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {saved ? 'Salvo!' : saving ? 'Salvando...' : 'Salvar configuração'}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-4">

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</p>
          )}

          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
            <strong>Como funciona:</strong> quando um orçamento muda para o status configurado, o lead vinculado
            é movido automaticamente para o stage escolhido — ou arquivado, se preferir.
          </div>

          {AUTOMATABLE.map(status => {
            const row = rows[status]
            return (
              <div key={status} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                {/* Status header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
                  <span className="text-xl">{STATUS_ICONS[status]}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TRIGGER_COLORS[status]}`}>
                        {TRIGGER_LABELS[status]}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{STATUS_DESCRIPTIONS[status]}</p>
                  </div>
                </div>

                {/* Action config */}
                <div className="px-5 py-4 space-y-3">
                  <p className="text-xs font-medium text-gray-600">Ação automática:</p>

                  <div className="space-y-2">
                    {/* Nenhuma ação */}
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                        row.action === 'none' ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                      }`}>
                        {row.action === 'none' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <input type="radio" className="sr-only" checked={row.action === 'none'} onChange={() => setRow(status, { action: 'none' })} />
                      <span className="text-sm text-gray-700">Nenhuma ação</span>
                    </label>

                    {/* Mover para stage */}
                    <label className="flex items-start gap-3 cursor-pointer">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors ${
                        row.action === 'move_stage' ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                      }`}>
                        {row.action === 'move_stage' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <input type="radio" className="sr-only" checked={row.action === 'move_stage'} onChange={() => setRow(status, { action: 'move_stage' })} />
                      <div className="flex-1">
                        <span className="text-sm text-gray-700">Mover lead para o stage:</span>
                        {row.action === 'move_stage' && (
                          <select
                            value={row.stage_id}
                            onChange={e => setRow(status, { stage_id: e.target.value })}
                            className="mt-2 w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Selecione um stage...</option>
                            {Object.values(stagesByFunnel).map(({ funnel, stages: fStages }) => (
                              <optgroup key={funnel} label={funnel}>
                                {fStages.map(s => (
                                  <option key={s.id} value={s.id}>{s.nome}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        )}
                      </div>
                    </label>

                    {/* Arquivar lead */}
                    <label className="flex items-center gap-3 cursor-pointer">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                        row.action === 'archive' ? 'border-red-500 bg-red-500' : 'border-gray-300'
                      }`}>
                        {row.action === 'archive' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <input type="radio" className="sr-only" checked={row.action === 'archive'} onChange={() => setRow(status, { action: 'archive' })} />
                      <span className="text-sm text-gray-700">Arquivar lead</span>
                    </label>
                  </div>

                  {/* Preview */}
                  {row.action === 'move_stage' && row.stage_id && (
                    <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
                      <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                      <span className="text-xs text-blue-700">
                        Lead moverá para <strong>{stages.find(s => s.id === row.stage_id)?.nome ?? '—'}</strong>
                      </span>
                    </div>
                  )}
                  {row.action === 'archive' && (
                    <div className="flex items-center gap-2 bg-red-50 rounded-xl px-3 py-2">
                      <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                      <span className="text-xs text-red-700">Lead será arquivado automaticamente</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
