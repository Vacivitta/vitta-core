'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile, AutomationTrigger } from '@/types/database'
import { QUOTE_STATUS_COLORS } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stage {
  id:        string
  nome:      string
  cor:       string
  funnel_id: string
  funnels:   { nome: string } | null
}

interface QuoteAutomation {
  id:           string
  unit_id:      string
  quote_status: AutomationTrigger
  action:       'move_stage' | 'archive' | 'none'
  stage_id:     string | null
  ativo:        boolean
}

interface WaAutomation {
  id:       string
  unit_id:  string
  trigger:  string
  action:   'move_stage' | 'none'
  stage_id: string | null
  ativo:    boolean
}

interface Props {
  currentUser:            Profile
  stages:                 Stage[]
  initialQuoteAutomations: QuoteAutomation[]
  initialWaAutomations:   WaAutomation[]
}

// ── Config maps ───────────────────────────────────────────────────────────────

const QUOTE_AUTOMATABLE: AutomationTrigger[] = ['criado', 'enviado', 'aceito', 'recusado']

const QUOTE_TRIGGER_META: Record<string, { label: string; desc: string; color: string }> = {
  criado:   { label: 'Orçamento Criado',      desc: 'Quando um orçamento é criado para o contato',       color: '#7C3AED' },
  enviado:  { label: 'Enviado ao Paciente',   desc: 'Quando o link do orçamento é copiado/enviado',      color: '#0098DA' },
  aceito:   { label: 'Aceito pelo Paciente',  desc: 'Quando o paciente aceita o orçamento',              color: '#1D9E75' },
  recusado: { label: 'Recusado pelo Paciente',desc: 'Quando o paciente recusa o orçamento',              color: '#EF4444' },
}

const WA_TRIGGERS: { key: string; label: string; desc: string; color: string }[] = [
  { key: 'inbound_message',       label: 'Contato envia mensagem',   desc: 'Primeira mensagem recebida — aciona ao chegar no WhatsApp', color: '#25D366' },
  { key: 'outbound_message',      label: 'Atendente responde',       desc: 'Quando qualquer atendente envia uma resposta ao contato',  color: '#0098DA' },
  { key: 'conversation_resolved', label: 'Conversa resolvida',       desc: 'Quando a conversa é marcada como Resolvida',              color: '#1D9E75' },
]

type RowState = { action: 'none' | 'move_stage'; stage_id: string }

// ── Component ─────────────────────────────────────────────────────────────────

export default function AutomacoesClient({ currentUser, stages, initialQuoteAutomations, initialWaAutomations }: Props) {
  const supabase = createClient()
  const unitId   = currentUser.unit_id ?? ''

  // Quote automation rows
  const initQuoteRows = (): Record<string, RowState> => {
    const r: Record<string, RowState> = {}
    for (const s of QUOTE_AUTOMATABLE) {
      const ex = initialQuoteAutomations.find(a => a.quote_status === s)
      r[s] = { action: ex?.action === 'archive' ? 'none' : (ex?.action ?? 'none'), stage_id: ex?.stage_id ?? '' }
    }
    return r
  }

  // WA automation rows
  const initWaRows = (): Record<string, RowState> => {
    const r: Record<string, RowState> = {}
    for (const t of WA_TRIGGERS) {
      const ex = initialWaAutomations.find(a => a.trigger === t.key)
      r[t.key] = { action: ex?.action ?? 'none', stage_id: ex?.stage_id ?? '' }
    }
    return r
  }

  const [quoteRows, setQuoteRows] = useState<Record<string, RowState>>(initQuoteRows)
  const [waRows,    setWaRows]    = useState<Record<string, RowState>>(initWaRows)
  const [savingQ,   setSavingQ]   = useState(false)
  const [savedQ,    setSavedQ]    = useState(false)
  const [savingWa,  setSavingWa]  = useState(false)
  const [savedWa,   setSavedWa]   = useState(false)
  const [error,     setError]     = useState('')

  function setQuoteRow(key: string, patch: Partial<RowState>) {
    setQuoteRows(p => ({ ...p, [key]: { ...p[key], ...patch } }))
    setSavedQ(false)
  }
  function setWaRow(key: string, patch: Partial<RowState>) {
    setWaRows(p => ({ ...p, [key]: { ...p[key], ...patch } }))
    setSavedWa(false)
  }

  // Stages grouped by funnel for the dropdown
  const stagesByFunnel = stages.reduce<Record<string, { funnel: string; stages: Stage[] }>>(
    (acc, s) => {
      const fn = s.funnel_id
      if (!acc[fn]) acc[fn] = { funnel: s.funnels?.nome ?? 'Funil', stages: [] }
      acc[fn].stages.push(s)
      return acc
    }, {}
  )

  async function saveQuote() {
    if (!unitId) { setError('Perfil sem unidade.'); return }
    setSavingQ(true); setError('')
    for (const status of QUOTE_AUTOMATABLE) {
      const row = quoteRows[status]
      const ex  = initialQuoteAutomations.find(a => a.quote_status === status)
      const payload = {
        unit_id: unitId, quote_status: status,
        action:   row.action,
        stage_id: row.action === 'move_stage' && row.stage_id ? row.stage_id : null,
        ativo: true,
      }
      if (ex) await supabase.from('quote_automations').update(payload).eq('id', ex.id)
      else    await supabase.from('quote_automations').insert(payload)
    }
    setSavingQ(false); setSavedQ(true)
  }

  async function saveWa() {
    if (!unitId) { setError('Perfil sem unidade.'); return }
    setSavingWa(true); setError('')
    for (const t of WA_TRIGGERS) {
      const row = waRows[t.key]
      const ex  = initialWaAutomations.find(a => a.trigger === t.key)
      const payload = {
        unit_id: unitId, trigger: t.key,
        action:   row.action,
        stage_id: row.action === 'move_stage' && row.stage_id ? row.stage_id : null,
        ativo: true,
      }
      if (ex) await supabase.from('wa_automations').update(payload).eq('id', ex.id)
      else    await supabase.from('wa_automations').insert(payload)
    }
    setSavingWa(false); setSavedWa(true)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

      {/* ── Page header ── */}
      <header style={{ background: '#fff', borderBottom: '1px solid #F1F4F7', padding: '18px 28px', flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0E2C3D', margin: 0, letterSpacing: '-0.02em' }}>Automações</h1>
        <p style={{ fontSize: 12, color: '#8FA0AF', margin: '3px 0 0' }}>
          Configure ações automáticas para movimentar contatos no funil com base em eventos
        </p>
      </header>

      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 28px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>

          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#DC2626' }}>
              {error}
            </div>
          )}

          {/* ── Seção WhatsApp ── */}
          <Section
            icon={
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: '#25D366' }}>
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            }
            title="Automações de Atendimento"
            desc="Mova o contato no funil automaticamente com base em eventos do WhatsApp"
            accentColor="#25D366"
            onSave={saveWa}
            saving={savingWa}
            saved={savedWa}
          >
            {WA_TRIGGERS.map(t => (
              <AutomationCard
                key={t.key}
                label={t.label}
                desc={t.desc}
                accentColor={t.color}
                row={waRows[t.key]}
                stages={stagesByFunnel}
                allStages={stages}
                onChange={patch => setWaRow(t.key, patch)}
              />
            ))}
          </Section>

          <Divider />

          {/* ── Seção Orçamentos ── */}
          <Section
            icon={
              <svg width="18" height="18" fill="none" stroke="#0098DA" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
            title="Automações de Orçamento"
            desc="Mova ou arquive o contato quando o status de um orçamento mudar"
            accentColor="#0098DA"
            onSave={saveQuote}
            saving={savingQ}
            saved={savedQ}
          >
            {QUOTE_AUTOMATABLE.map(status => {
              const meta = QUOTE_TRIGGER_META[status]
              return (
                <AutomationCard
                  key={status}
                  label={meta.label}
                  desc={meta.desc}
                  accentColor={meta.color}
                  row={quoteRows[status]}
                  stages={stagesByFunnel}
                  allStages={stages}
                  onChange={patch => setQuoteRow(status, patch)}
                />
              )
            })}
          </Section>

        </div>
      </main>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ icon, title, desc, accentColor, onSave, saving, saved, children }: {
  icon: React.ReactNode; title: string; desc: string; accentColor: string
  onSave: () => void; saving: boolean; saved: boolean; children: React.ReactNode
}) {
  return (
    <div>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: accentColor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {icon}
          </div>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 800, color: '#0E2C3D', margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
            <p style={{ fontSize: 11, color: '#8FA0AF', margin: 0 }}>{desc}</p>
          </div>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            fontSize: 12, fontWeight: 700, borderRadius: 9, border: 'none', cursor: saving ? 'default' : 'pointer',
            background: saved ? '#E8F7EE' : accentColor, color: saved ? '#1D9E75' : '#fff',
            opacity: saving ? 0.7 : 1, transition: 'all 0.2s', flexShrink: 0,
          }}
        >
          {saving && <Spinner />}
          {saved ? 'Salvo' : saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  )
}

// ── Automation card ───────────────────────────────────────────────────────────

interface AutomationCardProps {
  label:        string
  desc:         string
  accentColor:  string
  row:          RowState
  stages:       Record<string, { funnel: string; stages: Stage[] }>
  allStages:    Stage[]
  onChange:     (patch: Partial<RowState>) => void
}

function AutomationCard({ label, desc, accentColor, row, stages, allStages, onChange }: AutomationCardProps) {
  const targetStage = allStages.find(s => s.id === row.stage_id)

  return (
    <div style={{
      background: '#fff', border: '1px solid #F1F4F7', borderRadius: 14,
      overflow: 'hidden', borderLeft: `3px solid ${accentColor}`,
    }}>
      {/* Trigger row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid #F8FAFB' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: accentColor, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#0E2C3D', margin: 0 }}>{label}</p>
          <p style={{ fontSize: 11, color: '#8FA0AF', margin: 0 }}>{desc}</p>
        </div>
        {/* Quick status pill */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, flexShrink: 0,
          background: row.action !== 'none' ? accentColor + '18' : '#F1F4F7',
          color: row.action !== 'none' ? accentColor : '#B0BEC9',
        }}>
          {row.action === 'move_stage' ? 'Mover' : 'Sem ação'}
        </span>
      </div>

      {/* Action config */}
      <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#8FA0AF', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Ação automática</p>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['none', 'move_stage'] as Array<'none' | 'move_stage'>).map(a => (
            <button
              key={a}
              onClick={() => onChange({ action: a })}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
                background: row.action === a ? (a === 'none' ? '#F1F4F7' : accentColor) : '#fff',
                color: row.action === a ? (a === 'none' ? '#5A7184' : '#fff') : '#8FA0AF',
                borderColor: row.action === a ? (a === 'none' ? '#E8EDF2' : accentColor) : '#E8EDF2',
              }}
            >
              {a === 'none' ? 'Nenhuma ação' : 'Mover contato para →'}
            </button>
          ))}
        </div>

        {row.action === 'move_stage' && (
          <select
            value={row.stage_id}
            onChange={e => onChange({ stage_id: e.target.value })}
            style={{
              width: '100%', fontSize: 13, padding: '8px 12px', borderRadius: 9,
              border: `1px solid ${row.stage_id ? accentColor + '60' : '#E8EDF2'}`,
              background: '#F8FAFB', outline: 'none', color: '#0E2C3D', cursor: 'pointer',
            }}
          >
            <option value="">Selecione um estágio...</option>
            {Object.values(stages).map(({ funnel, stages: fStages }) => (
              <optgroup key={funnel} label={funnel}>
                {fStages.map(s => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

        {/* Preview arrow */}
        {row.action === 'move_stage' && row.stage_id && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: accentColor + '0D', border: `1px solid ${accentColor}30`, borderRadius: 8, padding: '7px 12px' }}>
            <svg width="14" height="14" fill="none" stroke={accentColor} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            <span style={{ fontSize: 12, color: accentColor, fontWeight: 600 }}>
              Contato move para <strong>{targetStage?.nome ?? '—'}</strong>
              {targetStage?.cor && (
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: targetStage.cor, marginLeft: 6, verticalAlign: 'middle' }} />
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shared ────────────────────────────────────────────────────────────────────

function Divider() {
  return <div style={{ height: 1, background: '#F1F4F7' }} />
}

function Spinner() {
  return (
    <div style={{ width: 13, height: 13, border: '2px solid #ffffff55', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
  )
}

// inline keyframes injected once
if (typeof document !== 'undefined' && !document.getElementById('spin-kf')) {
  const s = document.createElement('style')
  s.id = 'spin-kf'
  s.textContent = '@keyframes spin { to { transform: rotate(360deg) } }'
  document.head.appendChild(s)
}
