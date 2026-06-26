'use client'

import { useState, useEffect } from 'react'
import type { Profile } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetaTemplate {
  id: string; name: string; status: string; category: string; language: string
  components?: { type: string; text?: string }[]
  rejected_reason?: string
}

interface Props { currentUser: Profile }

const CATEGORIES = [
  { value: 'UTILITY',        label: 'Utilidade',       desc: 'Confirmações, atualizações, alertas de conta' },
  { value: 'MARKETING',      label: 'Marketing',        desc: 'Promoções, ofertas, conteúdo de engajamento' },
  { value: 'AUTHENTICATION', label: 'Autenticação',    desc: 'OTP, senhas temporárias, verificação' },
]

const LANGUAGES = [
  { value: 'pt_BR', label: 'Português (BR)' },
  { value: 'pt_PT', label: 'Português (PT)' },
  { value: 'en_US', label: 'English (US)' },
  { value: 'es',    label: 'Español' },
]

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  APPROVED: { bg: '#E8F7EE', text: '#1D9E75', label: 'Aprovado' },
  PENDING:  { bg: '#FFF8E1', text: '#F57F17', label: 'Pendente' },
  REJECTED: { bg: '#FEECEC', text: '#C0392B', label: 'Reprovado' },
  PAUSED:   { bg: '#F1F4F7', text: '#8FA0AF', label: 'Pausado' },
  DISABLED: { bg: '#F1F4F7', text: '#8FA0AF', label: 'Desativado' },
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function TemplatesWhatsAppClient({ currentUser: _ }: Props) {
  const [templates,  setTemplates]  = useState<MetaTemplate[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [showForm,   setShowForm]   = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [deleting,   setDeleting]   = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Form state
  const [form, setForm] = useState({
    name:        '',
    category:    'UTILITY' as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION',
    language:    'pt_BR',
    header_text: '',
    body_text:   '',
    footer_text: '',
  })
  const [formError, setFormError] = useState<string | null>(null)

  const wabaConfigured = typeof process !== 'undefined'

  async function loadTemplates() {
    setLoading(true); setError(null)
    const res = await fetch('/api/whatsapp/meta-templates')
    const data = await res.json() as { templates?: MetaTemplate[]; error?: string }
    if (data.error) setError(data.error)
    else setTemplates(data.templates ?? [])
    setLoading(false)
  }

  useEffect(() => { void loadTemplates() }, [])

  async function handleCreate() {
    setFormError(null)
    if (!form.name.trim()) { setFormError('Nome é obrigatório'); return }
    if (!/^[a-z0-9_]+$/.test(form.name)) { setFormError('Nome: apenas letras minúsculas, números e underscore'); return }
    if (!form.body_text.trim()) { setFormError('Corpo da mensagem é obrigatório'); return }

    setSaving(true)
    const res = await fetch('/api/whatsapp/meta-templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:        form.name,
        category:    form.category,
        language:    form.language,
        header_text: form.header_text || undefined,
        header_type: form.header_text ? 'TEXT' : undefined,
        body_text:   form.body_text,
        footer_text: form.footer_text || undefined,
      }),
    })
    const result = await res.json() as { success?: boolean; error?: string }
    setSaving(false)

    if (result.error) { setFormError(result.error); return }

    setShowForm(false)
    setForm({ name: '', category: 'UTILITY', language: 'pt_BR', header_text: '', body_text: '', footer_text: '' })
    setSuccessMsg('Template enviado para aprovação do Meta. Pode levar até 24h.')
    setTimeout(() => setSuccessMsg(null), 6000)
    void loadTemplates()
  }

  async function handleDelete(name: string, id: string) {
    if (!confirm(`Deletar o template "${name}" permanentemente? Esta ação não pode ser desfeita.`)) return
    setDeleting(name)
    setDeleteError(null)
    try {
      const params = new URLSearchParams({ name, hsm_id: id })
      const res    = await fetch(`/api/whatsapp/meta-templates?${params.toString()}`, { method: 'DELETE' })
      const data   = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || data.error) {
        setDeleteError(data.error ?? `Erro ao deletar (${res.status})`)
      } else {
        setSuccessMsg(`Template "${name}" deletado com sucesso.`)
        setTimeout(() => setSuccessMsg(null), 4000)
        void loadTemplates()
      }
    } catch {
      setDeleteError('Erro de conexão ao deletar o template.')
    } finally {
      setDeleting(null)
    }
  }

  const filtered = filterStatus === 'all' ? templates : templates.filter(t => t.status === filterStatus)
  const counts   = templates.reduce((acc, t) => { acc[t.status] = (acc[t.status] ?? 0) + 1; return acc }, {} as Record<string, number>)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0E2C3D', margin: 0 }}>Templates WhatsApp</h1>
          <p style={{ fontSize: 13, color: '#8FA0AF', margin: '4px 0 0' }}>
            Templates criados aqui são enviados ao Meta para aprovação e ficam disponíveis no chat após aprovados.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => void loadTemplates()} disabled={loading}
            style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, border: '1px solid #E8EDF2', borderRadius: 9, background: '#F8FAFB', cursor: 'pointer', color: '#5A7184' }}>
            {loading ? '...' : '↻ Atualizar'}
          </button>
          <button onClick={() => setShowForm(true)}
            style={{ padding: '9px 18px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 9, background: '#0098DA', color: '#fff', cursor: 'pointer' }}>
            + Novo template
          </button>
        </div>
      </div>

      {/* Env warning */}
      {!process.env.NEXT_PUBLIC_SUPABASE_URL && (
        <div style={{ padding: '12px 16px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: '#92400E', margin: 0, fontWeight: 600 }}>
            Configure <code>WHATSAPP_WABA_ID</code> e <code>WHATSAPP_ACCESS_TOKEN</code> no seu <code>.env.local</code> para conectar ao Meta.
          </p>
        </div>
      )}

      {/* Success msg */}
      {successMsg && (
        <div style={{ padding: '12px 16px', background: '#E8F7EE', border: '1px solid #A7F3D0', borderRadius: 10, marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: '#1D9E75', margin: 0, fontWeight: 600 }}>{successMsg}</p>
        </div>
      )}

      {/* Delete error */}
      {deleteError && (
        <div style={{ padding: '12px 16px', background: '#FEECEC', border: '1px solid #FECACA', borderRadius: 10, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontSize: 13, color: '#C0392B', margin: 0, fontWeight: 600 }}>Erro ao deletar: {deleteError}</p>
          <button onClick={() => setDeleteError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C0392B', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { value: 'all',      label: `Todos (${templates.length})` },
          { value: 'APPROVED', label: `Aprovados (${counts.APPROVED ?? 0})` },
          { value: 'PENDING',  label: `Pendentes (${counts.PENDING ?? 0})` },
          { value: 'REJECTED', label: `Reprovados (${counts.REJECTED ?? 0})` },
        ].map(f => (
          <button key={f.value} onClick={() => setFilterStatus(f.value)}
            style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 99, border: '1px solid', cursor: 'pointer',
              background: filterStatus === f.value ? '#0E2C3D' : 'transparent', color: filterStatus === f.value ? '#fff' : '#8FA0AF', borderColor: filterStatus === f.value ? '#0E2C3D' : '#E8EDF2' }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div style={{ padding: '16px', background: '#FEECEC', border: '1px solid #FECACA', borderRadius: 10, marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: '#C0392B', margin: 0 }}>Erro: {error}</p>
          <p style={{ fontSize: 11, color: '#E57373', margin: '4px 0 0' }}>Verifique se WHATSAPP_WABA_ID e WHATSAPP_ACCESS_TOKEN estão configurados.</p>
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <Spinner /> <span style={{ marginLeft: 10, color: '#8FA0AF', fontSize: 13 }}>Carregando templates do Meta...</span>
        </div>
      )}

      {/* Template list */}
      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#B0BEC9', fontSize: 13 }}>
              {templates.length === 0 ? 'Nenhum template ainda. Crie o primeiro acima.' : 'Nenhum template com este filtro.'}
            </div>
          )}
          {filtered.map(t => {
            const st = STATUS_STYLE[t.status] ?? STATUS_STYLE.PENDING
            const body = t.components?.find(c => c.type === 'BODY')?.text ?? ''
            const header = t.components?.find(c => c.type === 'HEADER')?.text ?? ''
            const footer = t.components?.find(c => c.type === 'FOOTER')?.text ?? ''
            return (
              <div key={t.id} style={{ background: '#fff', border: '1px solid #F1F4F7', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#0E2C3D', fontFamily: 'monospace' }}>{t.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: st.bg, color: st.text }}>{st.label}</span>
                      <span style={{ fontSize: 10, color: '#B0BEC9', background: '#F1F4F7', padding: '2px 7px', borderRadius: 99 }}>{t.category}</span>
                      <span style={{ fontSize: 10, color: '#B0BEC9', background: '#F1F4F7', padding: '2px 7px', borderRadius: 99 }}>{t.language}</span>
                    </div>
                    {/* WhatsApp-style preview */}
                    <div style={{ background: '#F8FAFB', border: '1px solid #E8EDF2', borderRadius: 10, padding: '10px 12px', maxWidth: 420 }}>
                      {header && <p style={{ fontSize: 12, fontWeight: 700, color: '#0E2C3D', margin: '0 0 6px' }}>{header}</p>}
                      <p style={{ fontSize: 12, color: '#0E2C3D', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{body || '(sem corpo)'}</p>
                      {footer && <p style={{ fontSize: 11, color: '#8FA0AF', margin: '6px 0 0' }}>{footer}</p>}
                    </div>
                    {t.rejected_reason && (
                      <p style={{ fontSize: 11, color: '#C0392B', margin: '6px 0 0' }}>Motivo da reprovação: {t.rejected_reason}</p>
                    )}
                  </div>
                  <button onClick={() => void handleDelete(t.name, t.id)} disabled={deleting === t.name}
                    style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, border: '1px solid #FECACA', borderRadius: 8, background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', flexShrink: 0, opacity: deleting === t.name ? 0.6 : 1 }}>
                    {deleting === t.name ? '...' : 'Deletar'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de criação */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,44,61,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, boxShadow: '0 16px 48px rgba(0,0,0,0.18)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: '#0E2C3D', margin: 0 }}>Novo template WhatsApp</h2>
              <button onClick={() => { setShowForm(false); setFormError(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B0BEC9', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Name */}
              <div>
                <label style={labelStyle}>Nome do template *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                  placeholder="ex: boas_vindas_clinica"
                  style={inputStyle} />
                <p style={{ fontSize: 10, color: '#B0BEC9', margin: '3px 0 0' }}>Apenas letras minúsculas, números e underscore. Imutável após criação.</p>
              </div>

              {/* Category */}
              <div>
                <label style={labelStyle}>Categoria *</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {CATEGORIES.map(c => (
                    <label key={c.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', border: `1.5px solid ${form.category === c.value ? '#0098DA' : '#E8EDF2'}`, borderRadius: 9, cursor: 'pointer', background: form.category === c.value ? '#F0F8FF' : '#fff' }}>
                      <input type="radio" name="category" value={c.value} checked={form.category === c.value} onChange={() => setForm(f => ({ ...f, category: c.value as typeof f.category }))} style={{ accentColor: '#0098DA', marginTop: 2, flexShrink: 0 }} />
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#0E2C3D' }}>{c.label}</span>
                        <p style={{ fontSize: 11, color: '#8FA0AF', margin: '1px 0 0' }}>{c.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div>
                <label style={labelStyle}>Idioma *</label>
                <select value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))} style={{ ...inputStyle, background: '#F8FAFB' }}>
                  {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>

              {/* Header */}
              <div>
                <label style={labelStyle}>Cabeçalho (opcional)</label>
                <input value={form.header_text} onChange={e => setForm(f => ({ ...f, header_text: e.target.value }))}
                  placeholder="Texto em negrito no topo da mensagem..."
                  style={inputStyle} />
              </div>

              {/* Body */}
              <div>
                <label style={labelStyle}>Corpo da mensagem *</label>
                <textarea value={form.body_text} onChange={e => setForm(f => ({ ...f, body_text: e.target.value }))}
                  placeholder={'Olá, {{1}}! Sua consulta foi confirmada para {{2}}.\nQualquer dúvida, estamos aqui.'}
                  rows={5} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }} />
                <p style={{ fontSize: 10, color: '#B0BEC9', margin: '3px 0 0' }}>Use {'{{1}}'}, {'{{2}}'} para variáveis (ex: nome do paciente, data).</p>
              </div>

              {/* Footer */}
              <div>
                <label style={labelStyle}>Rodapé (opcional)</label>
                <input value={form.footer_text} onChange={e => setForm(f => ({ ...f, footer_text: e.target.value }))}
                  placeholder="ex: Não responda a este número."
                  style={inputStyle} />
              </div>

              {formError && <p style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', padding: '8px 12px', borderRadius: 8, margin: 0 }}>{formError}</p>}

              {/* Info box */}
              <div style={{ padding: '10px 12px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 9 }}>
                <p style={{ fontSize: 11, color: '#1D4ED8', margin: 0, lineHeight: 1.5 }}>
                  ℹ️ Após criar, o template vai para revisão do Meta (geralmente 1-24h). Quando aprovado, aparece automaticamente disponível no chat.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={() => { setShowForm(false); setFormError(null) }}
                  style={{ flex: 1, padding: '10px', fontSize: 13, border: '1px solid #E8EDF2', borderRadius: 10, cursor: 'pointer', background: '#fff', color: '#5A7184', fontWeight: 600 }}>
                  Cancelar
                </button>
                <button onClick={() => void handleCreate()} disabled={saving}
                  style={{ flex: 2, padding: '10px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 10, cursor: saving ? 'default' : 'pointer', background: '#0098DA', color: '#fff', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Enviando...' : 'Enviar para aprovação →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5A7184', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 5 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 11px', fontSize: 13, border: '1px solid #E8EDF2', borderRadius: 9, outline: 'none', boxSizing: 'border-box', color: '#0E2C3D', background: '#fff' }

function Spinner() {
  return (
    <div style={{ width: 18, height: 18, border: '2px solid #0098DA33', borderTopColor: '#0098DA', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
  )
}
