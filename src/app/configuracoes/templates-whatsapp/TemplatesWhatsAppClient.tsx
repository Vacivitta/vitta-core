'use client'

import { useState, useEffect, useRef } from 'react'
import type { Profile } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetaTemplate {
  id: string; name: string; status: string; category: string; language: string
  components?: { type: string; format?: string; text?: string; example?: { header_handle?: string[] } }[]
  rejected_reason?: string
}

interface Props { currentUser: Profile }

const CATEGORIES = [
  { value: 'UTILITY',        label: 'Utilidade',    desc: 'Confirmações, atualizações, alertas de conta' },
  { value: 'MARKETING',      label: 'Marketing',    desc: 'Promoções, ofertas, conteúdo de engajamento' },
  { value: 'AUTHENTICATION', label: 'Autenticação', desc: 'OTP, senhas temporárias, verificação' },
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
  PAUSED:   { bg: '#F1EFE5', text: '#9AA79C', label: 'Pausado' },
  DISABLED: { bg: '#F1EFE5', text: '#9AA79C', label: 'Desativado' },
}

// Variáveis disponíveis para inserção
const VARIABLES = [
  { id: 'nome_cliente',    label: 'Nome do cliente',    example: 'Maria Silva' },
  { id: 'nome_atendente',  label: 'Nome do atendente',  example: 'João' },
  { id: 'data',            label: 'Data',               example: '26/06/2026' },
  { id: 'horario',         label: 'Horário',            example: '14:30' },
]

// ── Preview WhatsApp ──────────────────────────────────────────────────────────

function resolveVars(text: string, varOrder: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const idx = parseInt(n, 10) - 1
    const varId = varOrder[idx]
    const v = VARIABLES.find(x => x.id === varId)
    return v ? v.example : `{{${n}}}`
  })
}

function WhatsAppPreview({
  header, body, footer, varOrder, headerType, headerImageUrl,
}: {
  header: string; body: string; footer: string; varOrder: string[]
  headerType: 'NONE' | 'TEXT' | 'IMAGE'; headerImageUrl?: string | null
}) {
  const resolvedHeader = resolveVars(header, varOrder)
  const resolvedBody   = resolveVars(body,   varOrder)
  const resolvedFooter = resolveVars(footer, varOrder)
  const hasContent = headerType !== 'NONE' || body || footer

  return (
    <div style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#71856F', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>Preview</p>

      {/* Phone shell */}
      <div style={{
        background: '#ECE5DD',
        borderRadius: 24,
        padding: '32px 12px 20px',
        minHeight: 360,
        position: 'relative',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        border: '6px solid #1A1A1A',
      }}>
        {/* Status bar */}
        <div style={{ position: 'absolute', top: 8, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', padding: '0 14px', fontSize: 9, color: '#1A1A1A', fontWeight: 700 }}>
          <span>9:41</span>
          <span>●●●</span>
        </div>

        {/* WA header bar */}
        <div style={{ background: '#128C7E', margin: '-32px -12px 10px', padding: '10px 12px 8px', borderRadius: '18px 18px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>🏥</div>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#fff' }}>Clínica Vitta</p>
            <p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>online</p>
          </div>
        </div>

        {/* Chat area */}
        <div style={{ padding: '0 4px' }}>
          {!hasContent ? (
            <p style={{ fontSize: 11, color: '#9AA79C', textAlign: 'center', marginTop: 40 }}>Preencha o formulário para ver o preview</p>
          ) : (
            <div style={{
              background: '#fff',
              borderRadius: '0 10px 10px 10px',
              maxWidth: '85%',
              boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Triangle */}
              <div style={{ position: 'absolute', top: 0, left: -7, width: 0, height: 0, borderTop: '8px solid #fff', borderLeft: '7px solid transparent' }} />

              {/* Image header */}
              {headerType === 'IMAGE' && (
                headerImageUrl ? (
                  <img src={headerImageUrl} alt="Header" style={{ width: '100%', maxHeight: 120, objectFit: 'cover', display: 'block' }} />
                ) : (
                  <div style={{ width: '100%', height: 80, background: '#F1EFE5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 10, color: '#9AA79C' }}>📷 Imagem do cabeçalho</span>
                  </div>
                )
              )}

              <div style={{ padding: '8px 10px' }}>
                {headerType === 'TEXT' && resolvedHeader && (
                  <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: '#111', lineHeight: 1.4 }}>
                    {resolvedHeader}
                  </p>
                )}
                {resolvedBody && (
                  <p style={{ margin: 0, fontSize: 11.5, color: '#111', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {resolvedBody}
                  </p>
                )}
                {resolvedFooter && (
                  <p style={{ margin: '6px 0 0', fontSize: 10, color: '#9AA79C', lineHeight: 1.4 }}>
                    {resolvedFooter}
                  </p>
                )}
                <p style={{ margin: '4px 0 0', fontSize: 9, color: '#9AA79C', textAlign: 'right' }}>14:30 ✓✓</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Legenda de variáveis */}
      {varOrder.length > 0 && (
        <div style={{ background: '#E8F4E6', border: '1px solid #B5D6B3', borderRadius: 10, padding: '10px 12px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#1D4ED8', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Variáveis no template</p>
          {varOrder.map((varId, i) => {
            const v = VARIABLES.find(x => x.id === varId)
            if (!v) return null
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <code style={{ fontSize: 10, background: '#DBEAFE', color: '#1E40AF', padding: '1px 5px', borderRadius: 4 }}>{`{{${i + 1}}}`}</code>
                <span style={{ fontSize: 11, color: '#374151' }}>= {v.label}</span>
              </div>
            )
          })}
          <p style={{ fontSize: 10, color: '#6B7280', margin: '6px 0 0', lineHeight: 1.4 }}>
            Ao enviar pelo chat, os valores reais serão preenchidos automaticamente.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function TemplatesWhatsAppClient({ currentUser: _ }: Props) {
  const [templates,    setTemplates]    = useState<MetaTemplate[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [showForm,     setShowForm]     = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [deleting,     setDeleting]     = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [successMsg,   setSuccessMsg]   = useState<string | null>(null)
  const [deleteError,  setDeleteError]  = useState<string | null>(null)

  // Form state
  const [form, setForm] = useState({
    name:        '',
    category:    'UTILITY' as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION',
    language:    'pt_BR',
    header_type: 'NONE' as 'NONE' | 'TEXT' | 'IMAGE',
    header_text: '',
    body_text:   '',
    footer_text: '',
  })
  const [formError,        setFormError]        = useState<string | null>(null)
  const [headerImageFile,  setHeaderImageFile]  = useState<File | null>(null)
  const [headerImageUrl,   setHeaderImageUrl]   = useState<string | null>(null)
  const [headerImageHandle, setHeaderImageHandle] = useState<string | null>(null)
  const [uploadingImage,   setUploadingImage]   = useState(false)

  // Variáveis inseridas (em ordem de aparição)
  const [varOrder, setVarOrder] = useState<string[]>([])
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  async function loadTemplates() {
    setLoading(true); setError(null)
    const res = await fetch('/api/whatsapp/meta-templates')
    const data = await res.json() as { templates?: MetaTemplate[]; error?: string }
    if (data.error) setError(data.error)
    else setTemplates(data.templates ?? [])
    setLoading(false)
  }

  useEffect(() => { void loadTemplates() }, [])

  function resetForm() {
    setForm({ name: '', category: 'UTILITY', language: 'pt_BR', header_type: 'NONE', header_text: '', body_text: '', footer_text: '' })
    setVarOrder([])
    setFormError(null)
    setHeaderImageFile(null)
    setHeaderImageUrl(null)
    setHeaderImageHandle(null)
  }

  async function handleImageUpload(file: File) {
    setHeaderImageFile(file)
    setHeaderImageUrl(URL.createObjectURL(file))
    setHeaderImageHandle(null)
    setFormError(null)
    setUploadingImage(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/whatsapp/upload-template-media', { method: 'POST', body: fd })
      const data = await res.json() as { handle?: string; image_url?: string; error?: string }
      if (!res.ok || data.error) {
        setFormError(`Falha no upload: ${data.error ?? 'erro desconhecido'}`)
        setHeaderImageUrl(null)
        return
      }
      setHeaderImageHandle(data.handle ?? null)
      if (data.image_url) setHeaderImageUrl(data.image_url)
    } finally {
      setUploadingImage(false)
    }
  }

  // Inserção de variável no cursor do textarea
  function insertVariable(varId: string) {
    const textarea = bodyRef.current
    if (!textarea) return

    // Calcular próximo número de variável baseado na ordem atual no texto
    const currentText  = form.body_text
    const cursorStart  = textarea.selectionStart ?? currentText.length
    const cursorEnd    = textarea.selectionEnd   ?? currentText.length

    // Contar quantas {{N}} já existem antes do cursor para determinar nova posição
    const textBefore = currentText.slice(0, cursorStart)
    const existingVars = (textBefore.match(/\{\{\d+\}\}/g) ?? []).length
    const nextN = existingVars + 1

    // Remapear variáveis existentes após o ponto de inserção
    // Inserir a nova variável e re-numerar todo o texto
    const before = currentText.slice(0, cursorStart)
    const after  = currentText.slice(cursorEnd)
    const inserted = `{{${nextN}}}`

    // Recalcular o mapa de variáveis re-numerando as que vêm depois
    const newText = before + inserted + after

    // Reindexar: percorre o novo texto e reconstrói varOrder
    const newVarOrder = [...varOrder]
    // Inserir na posição correta (nextN - 1)
    newVarOrder.splice(nextN - 1, 0, varId)
    // Re-numerar variáveis no texto após a inserção
    let counter = 0
    const renumbered = newText.replace(/\{\{\d+\}\}/g, () => `{{${++counter}}}`)

    setForm(f => ({ ...f, body_text: renumbered }))
    setVarOrder(newVarOrder)

    // Restaurar foco e posição do cursor
    setTimeout(() => {
      textarea.focus()
      const pos = cursorStart + inserted.length
      textarea.setSelectionRange(pos, pos)
    }, 0)
  }

  // Sincroniza varOrder quando usuário edita o texto manualmente
  function handleBodyChange(text: string) {
    // Conta variáveis {{N}} presentes no texto
    const matches = [...text.matchAll(/\{\{(\d+)\}\}/g)].map(m => parseInt(m[1], 10))
    const maxN = matches.length > 0 ? Math.max(...matches) : 0
    // Truncar varOrder se variáveis foram removidas
    setVarOrder(prev => prev.slice(0, maxN))
    setForm(f => ({ ...f, body_text: text }))
  }

  async function handleCreate() {
    setFormError(null)
    if (!form.name.trim()) { setFormError('Nome é obrigatório'); return }
    if (!/^[a-z0-9_]+$/.test(form.name)) { setFormError('Nome: apenas letras minúsculas, números e underscore'); return }
    if (!form.body_text.trim()) { setFormError('Corpo da mensagem é obrigatório'); return }
    if (form.header_type === 'IMAGE' && !headerImageHandle) {
      setFormError('Aguardando upload da imagem ou falha no upload. Tente novamente.'); return
    }

    const bodyVariableExamples = varOrder.map(id => VARIABLES.find(v => v.id === id)?.example ?? '')

    setSaving(true)
    const res = await fetch('/api/whatsapp/meta-templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:                   form.name,
        category:               form.category,
        language:               form.language,
        header_type:            form.header_type === 'NONE' ? undefined : form.header_type,
        header_text:            form.header_type === 'TEXT' ? (form.header_text || undefined) : undefined,
        header_image_handle:    form.header_type === 'IMAGE' ? headerImageHandle : undefined,
        header_image_url:       form.header_type === 'IMAGE' ? headerImageUrl : undefined,
        body_text:              form.body_text,
        body_variable_examples: bodyVariableExamples.length > 0 ? bodyVariableExamples : undefined,
        body_variable_order:    varOrder.length > 0 ? varOrder : undefined,
        footer_text:            form.footer_text || undefined,
      }),
    })
    const result = await res.json() as { success?: boolean; error?: string }
    setSaving(false)

    if (result.error) { setFormError(result.error); return }

    setShowForm(false)
    resetForm()
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
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#25402C', margin: 0 }}>Templates WhatsApp</h1>
          <p style={{ fontSize: 13, color: '#9AA79C', margin: '4px 0 0' }}>
            Templates criados aqui são enviados ao Meta para aprovação e ficam disponíveis no chat após aprovados.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => void loadTemplates()} disabled={loading}
            style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, border: '1px solid #EBE7DA', borderRadius: 9, background: '#FBFAF4', cursor: 'pointer', color: '#71856F' }}>
            {loading ? '...' : '↻ Atualizar'}
          </button>
          <button onClick={() => { resetForm(); setShowForm(true) }}
            style={{ padding: '9px 18px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 9, background: '#3E9849', color: '#fff', cursor: 'pointer' }}>
            + Novo template
          </button>
        </div>
      </div>

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
              background: filterStatus === f.value ? '#25402C' : 'transparent', color: filterStatus === f.value ? '#fff' : '#9AA79C', borderColor: filterStatus === f.value ? '#25402C' : '#EBE7DA' }}>
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
          <Spinner /> <span style={{ marginLeft: 10, color: '#9AA79C', fontSize: 13 }}>Carregando templates do Meta...</span>
        </div>
      )}

      {/* Template list */}
      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#9AA79C', fontSize: 13 }}>
              {templates.length === 0 ? 'Nenhum template ainda. Crie o primeiro acima.' : 'Nenhum template com este filtro.'}
            </div>
          )}
          {filtered.map(t => {
            const st          = STATUS_STYLE[t.status] ?? STATUS_STYLE.PENDING
            const headerComp  = t.components?.find(c => c.type === 'HEADER')
            const body        = t.components?.find(c => c.type === 'BODY')?.text   ?? ''
            const headerText  = headerComp?.text ?? ''
            const headerFmt   = headerComp?.format ?? ''
            const footer      = t.components?.find(c => c.type === 'FOOTER')?.text ?? ''
            return (
              <div key={t.id} style={{ background: '#fff', border: '1px solid #F1EFE5', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#25402C', fontFamily: 'monospace' }}>{t.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: st.bg, color: st.text }}>{st.label}</span>
                      <span style={{ fontSize: 10, color: '#9AA79C', background: '#F1EFE5', padding: '2px 7px', borderRadius: 99 }}>{t.category}</span>
                      <span style={{ fontSize: 10, color: '#9AA79C', background: '#F1EFE5', padding: '2px 7px', borderRadius: 99 }}>{t.language}</span>
                      {headerFmt === 'IMAGE' && <span style={{ fontSize: 10, color: '#3E9849', background: '#E8F4E6', padding: '2px 7px', borderRadius: 99 }}>📷 Imagem</span>}
                    </div>
                    {/* Preview */}
                    <div style={{ background: '#FBFAF4', border: '1px solid #EBE7DA', borderRadius: 10, overflow: 'hidden', maxWidth: 420 }}>
                      {headerFmt === 'IMAGE' && (
                        <div style={{ padding: '8px 12px 0', fontSize: 11, color: '#9AA79C' }}>📷 <em>Cabeçalho com imagem</em></div>
                      )}
                      <div style={{ padding: '10px 12px' }}>
                        {headerText && <p style={{ fontSize: 12, fontWeight: 700, color: '#25402C', margin: '0 0 6px' }}>{headerText}</p>}
                        <p style={{ fontSize: 12, color: '#25402C', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{body || '(sem corpo)'}</p>
                        {footer && <p style={{ fontSize: 11, color: '#9AA79C', margin: '6px 0 0' }}>{footer}</p>}
                      </div>
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

      {/* ── Modal de criação ── */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,44,61,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 18, width: '100%', maxWidth: 920, boxShadow: '0 20px 60px rgba(0,0,0,0.22)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>

            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: '1px solid #F1EFE5', flexShrink: 0 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: '#25402C', margin: 0 }}>Novo template WhatsApp</h2>
              <button onClick={() => { setShowForm(false); resetForm() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9AA79C', fontSize: 22, lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>

            {/* Two-column body */}
            <div style={{ display: 'flex', gap: 0, flex: 1, overflow: 'hidden' }}>

              {/* Left: form */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                  {/* Name */}
                  <div>
                    <label style={labelStyle}>Nome do template *</label>
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                      placeholder="ex: confirmacao_consulta"
                      style={inputStyle} />
                    <p style={{ fontSize: 10, color: '#9AA79C', margin: '3px 0 0' }}>Apenas letras minúsculas, números e underscore. Imutável após criação.</p>
                  </div>

                  {/* Category */}
                  <div>
                    <label style={labelStyle}>Categoria *</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {CATEGORIES.map(c => (
                        <label key={c.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', border: `1.5px solid ${form.category === c.value ? '#3E9849' : '#EBE7DA'}`, borderRadius: 9, cursor: 'pointer', background: form.category === c.value ? '#E8F4E6' : '#fff' }}>
                          <input type="radio" name="category" value={c.value} checked={form.category === c.value} onChange={() => setForm(f => ({ ...f, category: c.value as typeof f.category }))} style={{ accentColor: '#3E9849', marginTop: 2, flexShrink: 0 }} />
                          <div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#25402C' }}>{c.label}</span>
                            <p style={{ fontSize: 11, color: '#9AA79C', margin: '1px 0 0' }}>{c.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Language */}
                  <div>
                    <label style={labelStyle}>Idioma *</label>
                    <select value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))} style={{ ...inputStyle, background: '#FBFAF4' }}>
                      {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>

                  {/* Header type */}
                  <div>
                    <label style={labelStyle}>Tipo de cabeçalho</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {([
                        { value: 'NONE',  label: 'Nenhum' },
                        { value: 'TEXT',  label: 'Texto' },
                        { value: 'IMAGE', label: '📷 Imagem' },
                      ] as const).map(opt => (
                        <button key={opt.value} type="button" onClick={() => setForm(f => ({ ...f, header_type: opt.value }))}
                          style={{ flex: 1, padding: '7px 10px', fontSize: 12, fontWeight: 600, border: `1.5px solid ${form.header_type === opt.value ? '#3E9849' : '#EBE7DA'}`,
                            borderRadius: 8, cursor: 'pointer', background: form.header_type === opt.value ? '#E8F4E6' : '#fff',
                            color: form.header_type === opt.value ? '#3E9849' : '#71856F' }}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Header text */}
                  {form.header_type === 'TEXT' && (
                    <div>
                      <label style={labelStyle}>Texto do cabeçalho</label>
                      <input value={form.header_text} onChange={e => setForm(f => ({ ...f, header_text: e.target.value }))}
                        placeholder="Texto em negrito no topo..."
                        style={inputStyle} />
                    </div>
                  )}

                  {/* Header image */}
                  {form.header_type === 'IMAGE' && (
                    <div>
                      <label style={labelStyle}>Imagem do cabeçalho</label>
                      {headerImageUrl ? (
                        <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1px solid #EBE7DA' }}>
                          <img src={headerImageUrl} alt="Header" style={{ width: '100%', maxHeight: 200, objectFit: 'contain', display: 'block', background: '#f5f5f0' }} />
                          <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', gap: 6 }}>
                            {uploadingImage && (
                              <span style={{ fontSize: 10, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '3px 8px', borderRadius: 6 }}>Fazendo upload...</span>
                            )}
                            {!uploadingImage && headerImageHandle && (
                              <span style={{ fontSize: 10, background: 'rgba(29,158,117,0.9)', color: '#fff', padding: '3px 8px', borderRadius: 6 }}>✓ Upload concluído</span>
                            )}
                            <label style={{ fontSize: 10, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '3px 8px', borderRadius: 6, cursor: 'pointer' }}>
                              Trocar
                              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                                onChange={e => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f) }} style={{ display: 'none' }} />
                            </label>
                          </div>
                        </div>
                      ) : (
                        <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, border: '2px dashed #EBE7DA', borderRadius: 10, padding: '24px 16px', cursor: 'pointer', background: '#FBFAF4' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#3E9849'; e.currentTarget.style.background = '#E8F4E6' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#EBE7DA'; e.currentTarget.style.background = '#FBFAF4' }}>
                          <span style={{ fontSize: 22 }}>📷</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#71856F' }}>Clique para fazer upload</span>
                          <span style={{ fontSize: 10, color: '#9AA79C' }}>JPEG, PNG ou WebP</span>
                          <input type="file" accept="image/jpeg,image/png,image/webp"
                            onChange={e => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f) }} style={{ display: 'none' }} />
                        </label>
                      )}
                      <p style={{ fontSize: 10, color: '#9AA79C', margin: '4px 0 0', lineHeight: 1.5 }}>
                        Tamanho recomendado: <strong>800 x 418 px</strong> (proporção 1.91:1). JPEG, PNG ou WebP.
                      </p>
                    </div>
                  )}

                  {/* Body */}
                  <div>
                    <label style={labelStyle}>Corpo da mensagem *</label>
                    <textarea
                      ref={bodyRef}
                      value={form.body_text}
                      onChange={e => handleBodyChange(e.target.value)}
                      placeholder={'Olá, {{1}}! Sua consulta foi confirmada para {{2}} às {{3}}.\nQualquer dúvida, estamos aqui.'}
                      rows={5}
                      style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }}
                    />

                    {/* Variable chips */}
                    <div style={{ marginTop: 8 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: '#9AA79C', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Inserir variável no cursor:</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {VARIABLES.map(v => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => insertVariable(v.id)}
                            style={{
                              padding: '4px 10px', fontSize: 11, fontWeight: 600,
                              border: '1px solid #B5D6B3', borderRadius: 99,
                              background: '#E8F4E6', color: '#1D4ED8',
                              cursor: 'pointer', transition: 'all 0.1s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#DBEAFE' }}
                            onMouseLeave={e => { e.currentTarget.style.background = '#E8F4E6' }}
                          >
                            + {v.label}
                          </button>
                        ))}
                      </div>
                      <p style={{ fontSize: 10, color: '#9AA79C', margin: '5px 0 0' }}>
                        Clique no botão com o cursor posicionado no texto para inserir <code>{'{{N}}'}</code>. Os valores são preenchidos automaticamente ao enviar.
                      </p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div>
                    <label style={labelStyle}>Rodapé (opcional)</label>
                    <input value={form.footer_text} onChange={e => setForm(f => ({ ...f, footer_text: e.target.value }))}
                      placeholder="ex: Não responda a este número."
                      style={inputStyle} />
                  </div>

                  {formError && <p style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', padding: '8px 12px', borderRadius: 8, margin: 0 }}>{formError}</p>}

                  {/* Info */}
                  <div style={{ padding: '10px 12px', background: '#E8F4E6', border: '1px solid #B5D6B3', borderRadius: 9 }}>
                    <p style={{ fontSize: 11, color: '#1D4ED8', margin: 0, lineHeight: 1.5 }}>
                      ℹ️ Após criar, o template vai para revisão do Meta (geralmente 1–24h). Quando aprovado, aparece automaticamente disponível no chat.
                    </p>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div style={{ width: 1, background: '#F1EFE5', flexShrink: 0 }} />

              {/* Right: preview */}
              <div style={{ width: 340, flexShrink: 0, overflowY: 'auto', padding: '20px 20px', background: '#FBFAF4' }}>
                <WhatsAppPreview
                  header={form.header_text}
                  body={form.body_text}
                  footer={form.footer_text}
                  varOrder={varOrder}
                  headerType={form.header_type}
                  headerImageUrl={headerImageUrl}
                />
              </div>
            </div>

            {/* Modal footer */}
            <div style={{ display: 'flex', gap: 8, padding: '14px 24px', borderTop: '1px solid #F1EFE5', flexShrink: 0 }}>
              <button onClick={() => { setShowForm(false); resetForm() }}
                style={{ flex: 1, padding: '10px', fontSize: 13, border: '1px solid #EBE7DA', borderRadius: 10, cursor: 'pointer', background: '#fff', color: '#71856F', fontWeight: 600 }}>
                Cancelar
              </button>
              <button onClick={() => void handleCreate()} disabled={saving}
                style={{ flex: 2, padding: '10px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 10, cursor: saving ? 'default' : 'pointer', background: '#3E9849', color: '#fff', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Enviando...' : 'Enviar para aprovação →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#71856F', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 5 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 11px', fontSize: 13, border: '1px solid #EBE7DA', borderRadius: 9, outline: 'none', boxSizing: 'border-box', color: '#25402C', background: '#fff' }

function Spinner() {
  return (
    <div style={{ width: 18, height: 18, border: '2px solid #3E984933', borderTopColor: '#3E9849', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
  )
}
