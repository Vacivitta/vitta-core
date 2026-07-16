'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile, AutomationTrigger } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stage {
  id: string; nome: string; cor: string; funnel_id: string
  funnels: { nome: string } | null
}

interface Funnel { id: string; nome: string }

interface WaTemplate {
  id: string; name: string; template_name: string | null; content: string; category: string
}

interface QuoteAutomation {
  id: string; unit_id: string; quote_status: AutomationTrigger
  action: 'move_stage' | 'archive' | 'none'; stage_id: string | null; ativo: boolean
}

interface WaAutomation {
  id: string; unit_id: string; trigger: string; action: string
  stage_id: string | null; template_id: string | null; ativo: boolean
}

interface TimedAutomation {
  id: string; unit_id: string; nome: string; condition: string
  threshold_hours: number; action: string
  template_id: string | null; action_stage_id: string | null
  filter_stage_id: string | null; filter_funnel_id: string | null
  ativo: boolean
}

interface Props {
  currentUser: Profile; stages: Stage[]
  initialQuoteAutomations: QuoteAutomation[]; initialWaAutomations: WaAutomation[]
  templates: WaTemplate[]; initialTimedAutomations: TimedAutomation[]; funnels: Funnel[]
}

// ── Config ────────────────────────────────────────────────────────────────────

const QUOTE_AUTOMATABLE: AutomationTrigger[] = ['criado', 'enviado', 'aceito', 'recusado']

const QUOTE_TRIGGER_META: Record<string, { label: string; desc: string; color: string }> = {
  criado:   { label: 'Orçamento Criado',       desc: 'Quando um orçamento é criado para o contato',  color: '#7C3AED' },
  enviado:  { label: 'Enviado ao Paciente',    desc: 'Quando o link do orçamento é copiado/enviado', color: '#3E9849' },
  aceito:   { label: 'Aceito pelo Paciente',   desc: 'Quando o paciente aceita o orçamento',         color: '#1D9E75' },
  recusado: { label: 'Recusado pelo Paciente', desc: 'Quando o paciente recusa o orçamento',         color: '#EF4444' },
}

const WA_TRIGGERS = [
  { key: 'inbound_message',       label: 'Contato envia mensagem', desc: 'Quando uma mensagem é recebida no WhatsApp',            color: '#25D366' },
  { key: 'outbound_message',      label: 'Atendente responde',     desc: 'Quando qualquer atendente envia uma resposta ao contato', color: '#3E9849' },
  { key: 'conversation_resolved', label: 'Conversa resolvida',     desc: 'Quando a conversa é marcada como Resolvida',             color: '#1D9E75' },
]

const TIMED_CONDITIONS = [
  { key: 'no_patient_reply',  label: 'Sem resposta do paciente',       desc: 'Última mensagem foi do atendente e paciente não respondeu' },
  { key: 'no_agent_reply',    label: 'Sem resposta do atendente',      desc: 'Paciente enviou mensagem e nenhum atendente respondeu' },
  { key: 'lead_stuck_stage',  label: 'Lead parado na mesma etapa',     desc: 'Lead está na mesma etapa do funil há muito tempo' },
  { key: 'lead_no_task',      label: 'Lead sem tarefa futura agendada', desc: 'Lead ativo sem nenhuma tarefa pendente' },
]

const TIMED_ACTIONS = [
  { key: 'send_template', label: 'Enviar template WhatsApp' },
  { key: 'move_stage',    label: 'Mover para etapa' },
]

type ActionType = 'none' | 'move_stage' | 'send_template'
type RowState = { action: ActionType; stage_id: string; template_id: string }

const ACCENT_TIMED = '#F59E0B'

// ── Component ─────────────────────────────────────────────────────────────────

export default function AutomacoesClient({
  currentUser, stages, initialQuoteAutomations, initialWaAutomations, templates, initialTimedAutomations, funnels,
}: Props) {
  const supabase = createClient()
  const unitId   = currentUser.unit_id ?? ''

  // ── Fixed WA rows ──
  const initWaRows = (): Record<string, RowState> => {
    const r: Record<string, RowState> = {}
    for (const t of WA_TRIGGERS) {
      const ex = initialWaAutomations.find(a => a.trigger === t.key)
      r[t.key] = { action: (ex?.action ?? 'none') as ActionType, stage_id: ex?.stage_id ?? '', template_id: ex?.template_id ?? '' }
    }
    return r
  }
  const initQuoteRows = (): Record<string, RowState> => {
    const r: Record<string, RowState> = {}
    for (const s of QUOTE_AUTOMATABLE) {
      const ex = initialQuoteAutomations.find(a => a.quote_status === s)
      r[s] = { action: ex?.action === 'archive' ? 'none' : (ex?.action ?? 'none') as ActionType, stage_id: ex?.stage_id ?? '', template_id: '' }
    }
    return r
  }

  const [quoteRows, setQuoteRows] = useState<Record<string, RowState>>(initQuoteRows)
  const [waRows, setWaRows]       = useState<Record<string, RowState>>(initWaRows)
  const [savingQ, setSavingQ]     = useState(false)
  const [savedQ, setSavedQ]       = useState(false)
  const [savingWa, setSavingWa]   = useState(false)
  const [savedWa, setSavedWa]     = useState(false)
  const [error, setError]         = useState('')

  // ── Timed automations ──
  const [timedAutos, setTimedAutos] = useState<TimedAutomation[]>(initialTimedAutomations)
  const [showNewTimed, setShowNewTimed] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCondition, setNewCondition] = useState('')
  const [newThresholdHours, setNewThresholdHours] = useState(48)
  const [newTimedAction, setNewTimedAction] = useState('send_template')
  const [newTimedTemplateId, setNewTimedTemplateId] = useState('')
  const [newTimedStageId, setNewTimedStageId] = useState('')
  const [newFilterFunnelId, setNewFilterFunnelId] = useState('')
  const [newFilterStageId, setNewFilterStageId] = useState('')
  const [savingTimed, setSavingTimed] = useState(false)
  const [deletingTimedId, setDeletingTimedId] = useState<string | null>(null)

  function setQuoteRow(key: string, patch: Partial<RowState>) { setQuoteRows(p => ({ ...p, [key]: { ...p[key], ...patch } })); setSavedQ(false) }
  function setWaRow(key: string, patch: Partial<RowState>) { setWaRows(p => ({ ...p, [key]: { ...p[key], ...patch } })); setSavedWa(false) }

  const stagesByFunnel = stages.reduce<Record<string, { funnel: string; stages: Stage[] }>>((acc, s) => {
    const fn = s.funnel_id
    if (!acc[fn]) acc[fn] = { funnel: s.funnels?.nome ?? 'Funil', stages: [] }
    acc[fn].stages.push(s)
    return acc
  }, {})

  const filterStages = newFilterFunnelId
    ? stages.filter(s => s.funnel_id === newFilterFunnelId)
    : stages

  async function saveQuote() {
    if (!unitId) { setError('Perfil sem unidade.'); return }
    setSavingQ(true); setError('')
    for (const status of QUOTE_AUTOMATABLE) {
      const row = quoteRows[status]
      const ex  = initialQuoteAutomations.find(a => a.quote_status === status)
      const payload = { unit_id: unitId, quote_status: status, action: row.action === 'send_template' ? 'none' : row.action, stage_id: row.action === 'move_stage' && row.stage_id ? row.stage_id : null, ativo: true }
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
        unit_id: unitId, trigger: t.key, action: row.action,
        stage_id: row.action === 'move_stage' && row.stage_id ? row.stage_id : null,
        template_id: row.action === 'send_template' && row.template_id ? row.template_id : null,
        ativo: true,
      }
      if (ex) await supabase.from('wa_automations').update(payload).eq('id', ex.id)
      else    await supabase.from('wa_automations').insert(payload)
    }
    setSavingWa(false); setSavedWa(true)
  }

  async function createTimedAutomation() {
    if (!unitId || !newCondition || !newTimedAction) return
    if (newTimedAction === 'send_template' && !newTimedTemplateId) return
    if (newTimedAction === 'move_stage' && !newTimedStageId) return

    setSavingTimed(true); setError('')
    const payload = {
      unit_id: unitId,
      nome: newName || conditionLabel(newCondition),
      condition: newCondition,
      threshold_hours: newThresholdHours,
      action: newTimedAction,
      template_id: newTimedAction === 'send_template' ? newTimedTemplateId : null,
      action_stage_id: newTimedAction === 'move_stage' ? newTimedStageId : null,
      filter_stage_id: newFilterStageId || null,
      filter_funnel_id: newFilterFunnelId || null,
      ativo: true,
    }
    const { data, error: err } = await supabase.from('wa_timed_automations').insert(payload).select('*').single()
    if (err) { setError('Erro ao criar: ' + err.message); setSavingTimed(false); return }
    if (data) setTimedAutos(prev => [...prev, data as TimedAutomation])
    resetNewForm()
    setSavingTimed(false)
  }

  function resetNewForm() {
    setShowNewTimed(false); setNewName(''); setNewCondition(''); setNewThresholdHours(48)
    setNewTimedAction('send_template'); setNewTimedTemplateId(''); setNewTimedStageId('')
    setNewFilterFunnelId(''); setNewFilterStageId('')
  }

  async function deleteTimedAutomation(id: string) {
    setDeletingTimedId(id)
    await supabase.from('wa_timed_automations').delete().eq('id', id)
    setTimedAutos(prev => prev.filter(a => a.id !== id))
    setDeletingTimedId(null)
  }

  async function toggleTimedAutomation(id: string, ativo: boolean) {
    await supabase.from('wa_timed_automations').update({ ativo: !ativo }).eq('id', id)
    setTimedAutos(prev => prev.map(a => a.id === id ? { ...a, ativo: !ativo } : a))
  }

  const conditionLabel = (key: string) => TIMED_CONDITIONS.find(c => c.key === key)?.label ?? key
  const actionLabel = (key: string) => TIMED_ACTIONS.find(a => a.key === key)?.label ?? key

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #F1EFE5', padding: '18px 28px', flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#25402C', margin: 0, letterSpacing: '-0.02em' }}>Automações</h1>
        <p style={{ fontSize: 12, color: '#9AA79C', margin: '3px 0 0' }}>Configure ações automáticas com base em eventos e condições de tempo</p>
      </header>

      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 28px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>

          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#DC2626' }}>{error}</div>
          )}

          {/* ══════════════ Automações por Tempo ══════════════ */}
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: ACCENT_TIMED + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" fill="none" stroke={ACCENT_TIMED} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 800, color: '#25402C', margin: 0 }}>Automações por Tempo</h2>
                  <p style={{ fontSize: 11, color: '#9AA79C', margin: 0 }}>Ações automáticas baseadas em inatividade, leads parados e follow-ups</p>
                </div>
              </div>
              <button onClick={() => setShowNewTimed(v => !v)} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '8px 16px', fontSize: 12, fontWeight: 700, borderRadius: 9, border: 'none', cursor: 'pointer',
                background: showNewTimed ? '#F1EFE5' : ACCENT_TIMED, color: showNewTimed ? '#71856F' : '#fff', transition: 'all 0.2s', flexShrink: 0,
              }}>
                {showNewTimed ? 'Cancelar' : '+ Nova regra'}
              </button>
            </div>

            {/* ── New timed automation form ── */}
            {showNewTimed && (
              <div style={{ background: '#fff', border: `1px solid ${ACCENT_TIMED}40`, borderRadius: 14, padding: 18, marginBottom: 12, borderLeft: `3px solid ${ACCENT_TIMED}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                  {/* Name */}
                  <div>
                    <Label>Nome da regra (opcional)</Label>
                    <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Follow-up 48h sem resposta"
                      style={inputStyle} />
                  </div>

                  {/* Condition */}
                  <div>
                    <Label>Condição</Label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {TIMED_CONDITIONS.map(c => (
                        <label key={c.key} style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                          border: `1px solid ${newCondition === c.key ? ACCENT_TIMED : '#EBE7DA'}`,
                          background: newCondition === c.key ? ACCENT_TIMED + '0D' : '#FBFAF4',
                          transition: 'all 0.15s',
                        }}>
                          <input type="radio" name="condition" value={c.key} checked={newCondition === c.key}
                            onChange={() => setNewCondition(c.key)}
                            style={{ accentColor: ACCENT_TIMED }} />
                          <div>
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#25402C' }}>{c.label}</span>
                            <p style={{ fontSize: 11, color: '#9AA79C', margin: 0 }}>{c.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Threshold */}
                  {newCondition && (
                    <div>
                      <Label>Após quanto tempo</Label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="number" min={1} max={720} value={newThresholdHours}
                          onChange={e => setNewThresholdHours(parseInt(e.target.value) || 48)}
                          style={{ ...inputStyle, width: 80, textAlign: 'center' }} />
                        <span style={{ fontSize: 13, color: '#71856F' }}>horas</span>
                        <span style={{ fontSize: 11, color: '#9AA79C' }}>
                          ({newThresholdHours >= 24 ? `${Math.floor(newThresholdHours / 24)} dia${Math.floor(newThresholdHours / 24) !== 1 ? 's' : ''}` : `${newThresholdHours}h`})
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Filters */}
                  {newCondition && (
                    <div>
                      <Label>Filtrar por funil/etapa (opcional)</Label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <select value={newFilterFunnelId} onChange={e => { setNewFilterFunnelId(e.target.value); setNewFilterStageId('') }}
                          style={{ ...inputStyle, flex: 1, minWidth: 160 }}>
                          <option value="">Todos os funis</option>
                          {funnels.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                        </select>
                        <select value={newFilterStageId} onChange={e => setNewFilterStageId(e.target.value)}
                          style={{ ...inputStyle, flex: 1, minWidth: 160 }}>
                          <option value="">Todas as etapas</option>
                          {filterStages.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Action */}
                  {newCondition && (
                    <div>
                      <Label>Ação</Label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {TIMED_ACTIONS.map(a => (
                          <button key={a.key} onClick={() => setNewTimedAction(a.key)} style={{
                            padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
                            background: newTimedAction === a.key ? ACCENT_TIMED : '#fff',
                            color: newTimedAction === a.key ? '#fff' : '#9AA79C',
                            borderColor: newTimedAction === a.key ? ACCENT_TIMED : '#EBE7DA',
                          }}>{a.label}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Template picker */}
                  {newCondition && newTimedAction === 'send_template' && (
                    <div>
                      <Label>Template</Label>
                      <select value={newTimedTemplateId} onChange={e => setNewTimedTemplateId(e.target.value)} style={inputStyle}>
                        <option value="">Selecione um template...</option>
                        {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.category === 'meta_api' ? ' (Meta)' : ''}</option>)}
                      </select>
                      <p style={{ fontSize: 10, color: '#9AA79C', margin: '4px 0 0' }}>
                        Variáveis {'{{1}}'}, {'{{2}}'} etc. são preenchidas automaticamente (nome do cliente, data, horário)
                      </p>
                    </div>
                  )}

                  {/* Stage picker */}
                  {newCondition && newTimedAction === 'move_stage' && (
                    <div>
                      <Label>Mover para</Label>
                      <select value={newTimedStageId} onChange={e => setNewTimedStageId(e.target.value)} style={inputStyle}>
                        <option value="">Selecione uma etapa...</option>
                        {Object.values(stagesByFunnel).map(({ funnel, stages: fs }) => (
                          <optgroup key={funnel} label={funnel}>
                            {fs.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Summary + Save */}
                  {newCondition && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 4 }}>
                      <button onClick={createTimedAutomation}
                        disabled={savingTimed || !newCondition || (newTimedAction === 'send_template' && !newTimedTemplateId) || (newTimedAction === 'move_stage' && !newTimedStageId)}
                        style={{
                          padding: '10px 24px', fontSize: 13, fontWeight: 700, borderRadius: 9, border: 'none', cursor: 'pointer',
                          background: ACCENT_TIMED, color: '#fff', opacity: savingTimed ? 0.7 : 1,
                        }}>
                        {savingTimed ? 'Salvando...' : 'Criar regra'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Existing timed automations list ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {timedAutos.length === 0 && !showNewTimed && (
                <div style={{ background: '#FBFAF4', border: '1px dashed #EBE7DA', borderRadius: 12, padding: '24px 18px', textAlign: 'center' }}>
                  <p style={{ fontSize: 13, color: '#9AA79C', margin: 0 }}>Nenhuma automação por tempo configurada</p>
                  <p style={{ fontSize: 11, color: '#B8C4BA', margin: '4px 0 0' }}>Crie regras de follow-up automático, alerta de inatividade e mais</p>
                </div>
              )}

              {timedAutos.map(auto => {
                const tpl = templates.find(t => t.id === auto.template_id)
                const stg = stages.find(s => s.id === auto.action_stage_id)
                const filterStg = stages.find(s => s.id === auto.filter_stage_id)
                const filterFnl = funnels.find(f => f.id === auto.filter_funnel_id)
                const days = auto.threshold_hours >= 24 ? `${Math.floor(auto.threshold_hours / 24)}d` : `${auto.threshold_hours}h`

                return (
                  <div key={auto.id} style={{
                    background: '#fff', border: '1px solid #F1EFE5', borderRadius: 12,
                    borderLeft: `3px solid ${auto.ativo ? ACCENT_TIMED : '#D1D5DB'}`,
                    padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
                    opacity: auto.ativo ? 1 : 0.5, transition: 'opacity 0.2s',
                  }}>
                    <button onClick={() => toggleTimedAutomation(auto.id, auto.ativo)} style={{
                      width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
                      background: auto.ativo ? ACCENT_TIMED : '#D1D5DB', transition: 'background 0.2s',
                    }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2,
                        left: auto.ativo ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                      }} />
                    </button>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {auto.nome && <p style={{ fontSize: 13, fontWeight: 700, color: '#25402C', margin: '0 0 4px' }}>{auto.nome}</p>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Pill bg={ACCENT_TIMED + '15'} color={ACCENT_TIMED}>{conditionLabel(auto.condition)}</Pill>
                        <Pill bg="#FEF3C7" color="#92400E">{days}</Pill>
                        <svg width="12" height="12" fill="none" stroke="#9AA79C" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                        <Pill bg="#F1EFE5" color="#25402C">{actionLabel(auto.action)}</Pill>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                        {auto.action === 'send_template' && tpl && (
                          <span style={{ fontSize: 11, color: '#71856F' }}>Template: <strong>{tpl.name}</strong></span>
                        )}
                        {auto.action === 'move_stage' && stg && (
                          <span style={{ fontSize: 11, color: '#71856F' }}>
                            Para: <strong>{stg.nome}</strong>
                            {stg.cor && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: stg.cor, marginLeft: 4, verticalAlign: 'middle' }} />}
                          </span>
                        )}
                        {(filterFnl || filterStg) && (
                          <span style={{ fontSize: 11, color: '#9AA79C' }}>
                            Filtro: {filterFnl?.nome}{filterStg ? ` → ${filterStg.nome}` : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    <button onClick={() => deleteTimedAutomation(auto.id)} disabled={deletingTimedId === auto.id}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D1D5DB', padding: 4, flexShrink: 0, opacity: deletingTimedId === auto.id ? 0.4 : 1 }}>
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7M10 11v6m4-6v6M4 7h16M9 7V4h6v3" /></svg>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <Divider />

          {/* ══════════════ WA event-based ══════════════ */}
          <Section
            icon={<svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: '#25D366' }}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>}
            title="Automações por Evento" desc="Ações instantâneas quando um evento de WhatsApp acontece" accentColor="#25D366"
            onSave={saveWa} saving={savingWa} saved={savedWa}
          >
            {WA_TRIGGERS.map(t => (
              <AutomationCard key={t.key} label={t.label} desc={t.desc} accentColor={t.color}
                row={waRows[t.key]} stages={stagesByFunnel} allStages={stages} templates={templates} showTemplatePicker
                onChange={patch => setWaRow(t.key, patch)} />
            ))}
          </Section>

          <Divider />

          {/* ══════════════ Orçamentos ══════════════ */}
          <Section
            icon={<svg width="18" height="18" fill="none" stroke="#3E9849" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
            title="Automações de Orçamento" desc="Mova o contato quando o status de um orçamento mudar" accentColor="#3E9849"
            onSave={saveQuote} saving={savingQ} saved={savedQ}
          >
            {QUOTE_AUTOMATABLE.map(status => {
              const meta = QUOTE_TRIGGER_META[status]
              return (
                <AutomationCard key={status} label={meta.label} desc={meta.desc} accentColor={meta.color}
                  row={quoteRows[status]} stages={stagesByFunnel} allStages={stages} templates={[]}
                  onChange={patch => setQuoteRow(status, patch)} />
              )
            })}
          </Section>
        </div>
      </main>
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <label style={{ fontSize: 11, fontWeight: 700, color: '#9AA79C', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>{children}</label>
}

function Pill({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color, background: bg, padding: '2px 8px', borderRadius: 6 }}>{children}</span>
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '8px 12px', borderRadius: 9,
  border: '1px solid #EBE7DA', background: '#FBFAF4', outline: 'none', color: '#25402C', boxSizing: 'border-box',
}

function Section({ icon, title, desc, accentColor, onSave, saving, saved, children }: {
  icon: React.ReactNode; title: string; desc: string; accentColor: string
  onSave: () => void; saving: boolean; saved: boolean; children: React.ReactNode
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: accentColor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</div>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 800, color: '#25402C', margin: 0 }}>{title}</h2>
            <p style={{ fontSize: 11, color: '#9AA79C', margin: 0 }}>{desc}</p>
          </div>
        </div>
        <button onClick={onSave} disabled={saving} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 12, fontWeight: 700, borderRadius: 9, border: 'none',
          cursor: saving ? 'default' : 'pointer', background: saved ? '#E8F7EE' : accentColor, color: saved ? '#1D9E75' : '#fff',
          opacity: saving ? 0.7 : 1, transition: 'all 0.2s', flexShrink: 0,
        }}>
          {saving && <Spinner />}
          {saved ? 'Salvo' : saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  )
}

interface AutomationCardProps {
  label: string; desc: string; accentColor: string; row: RowState
  stages: Record<string, { funnel: string; stages: Stage[] }>; allStages: Stage[]
  templates: WaTemplate[]; showTemplatePicker?: boolean
  onChange: (patch: Partial<RowState>) => void
}

function AutomationCard({ label, desc, accentColor, row, stages, allStages, templates, showTemplatePicker, onChange }: AutomationCardProps) {
  const targetStage = allStages.find(s => s.id === row.stage_id)
  const targetTemplate = templates.find(t => t.id === row.template_id)
  const statusLabel = row.action === 'move_stage' ? 'Mover' : row.action === 'send_template' ? 'Template' : 'Sem ação'
  const actions: { key: ActionType; label: string }[] = [
    { key: 'none', label: 'Nenhuma ação' }, { key: 'move_stage', label: 'Mover contato para →' },
  ]
  if (showTemplatePicker) actions.push({ key: 'send_template', label: 'Enviar template' })

  return (
    <div style={{ background: '#fff', border: '1px solid #F1EFE5', borderRadius: 14, overflow: 'hidden', borderLeft: `3px solid ${accentColor}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid #FBFAF4' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: accentColor, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#25402C', margin: 0 }}>{label}</p>
          <p style={{ fontSize: 11, color: '#9AA79C', margin: 0 }}>{desc}</p>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, flexShrink: 0,
          background: row.action !== 'none' ? accentColor + '18' : '#F1EFE5', color: row.action !== 'none' ? accentColor : '#9AA79C' }}>{statusLabel}</span>
      </div>
      <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#9AA79C', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Ação automática</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {actions.map(a => (
            <button key={a.key} onClick={() => onChange({ action: a.key })} style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
              background: row.action === a.key ? (a.key === 'none' ? '#F1EFE5' : accentColor) : '#fff',
              color: row.action === a.key ? (a.key === 'none' ? '#71856F' : '#fff') : '#9AA79C',
              borderColor: row.action === a.key ? (a.key === 'none' ? '#EBE7DA' : accentColor) : '#EBE7DA',
            }}>{a.label}</button>
          ))}
        </div>
        {row.action === 'move_stage' && (
          <select value={row.stage_id} onChange={e => onChange({ stage_id: e.target.value })} style={{
            ...inputStyle, border: `1px solid ${row.stage_id ? accentColor + '60' : '#EBE7DA'}`, cursor: 'pointer',
          }}>
            <option value="">Selecione um estágio...</option>
            {Object.values(stages).map(({ funnel, stages: fs }) => (
              <optgroup key={funnel} label={funnel}>{fs.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</optgroup>
            ))}
          </select>
        )}
        {row.action === 'send_template' && (
          <>
            <select value={row.template_id} onChange={e => onChange({ template_id: e.target.value })} style={{
              ...inputStyle, border: `1px solid ${row.template_id ? accentColor + '60' : '#EBE7DA'}`, cursor: 'pointer',
            }}>
              <option value="">Selecione um template...</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.category === 'meta_api' ? ' (Meta)' : ''}</option>)}
            </select>
            <p style={{ fontSize: 10, color: '#9AA79C', margin: 0 }}>Variáveis {'{{1}}'} preenchidas automaticamente: nome do cliente, atendente, data e horário</p>
          </>
        )}
        {row.action === 'move_stage' && row.stage_id && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: accentColor + '0D', border: `1px solid ${accentColor}30`, borderRadius: 8, padding: '7px 12px' }}>
            <svg width="14" height="14" fill="none" stroke={accentColor} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            <span style={{ fontSize: 12, color: accentColor, fontWeight: 600 }}>
              Contato move para <strong>{targetStage?.nome ?? '—'}</strong>
              {targetStage?.cor && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: targetStage.cor, marginLeft: 6, verticalAlign: 'middle' }} />}
            </span>
          </div>
        )}
        {row.action === 'send_template' && row.template_id && targetTemplate && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: accentColor + '0D', border: `1px solid ${accentColor}30`, borderRadius: 8, padding: '7px 12px' }}>
            <svg width="14" height="14" fill="none" stroke={accentColor} viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12, color: accentColor, fontWeight: 600 }}>Envia template <strong>{targetTemplate.name}</strong></span>
              {targetTemplate.content && <p style={{ fontSize: 11, color: '#9AA79C', margin: '2px 0 0', whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{targetTemplate.content}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Divider() { return <div style={{ height: 1, background: '#F1EFE5' }} /> }

function Spinner() {
  return <div style={{ width: 13, height: 13, border: '2px solid #ffffff55', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
}

if (typeof document !== 'undefined' && !document.getElementById('spin-kf')) {
  const s = document.createElement('style'); s.id = 'spin-kf'
  s.textContent = '@keyframes spin { to { transform: rotate(360deg) } }'
  document.head.appendChild(s)
}
