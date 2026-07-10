'use client'

import { useState, useEffect } from 'react'

interface MetaApprovedTemplate { name: string; language: string; bodyText: string }

interface Props {
  unitId:  string
  onStart: (phone: string, unitId: string, templateName: string, language: string, components: object[], registerOptin: boolean, bodyText: string) => Promise<void>
  onClose: () => void
}

export default function NewConversationModal({ unitId, onStart, onClose }: Props) {
  const [phone,        setPhone]        = useState('')
  const [tmplIdx,      setTmplIdx]      = useState(0)
  const [sending,      setSending]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [metaTmpls,    setMetaTmpls]    = useState<MetaApprovedTemplate[] | null>(null)
  const [loadingT,     setLoadingT]     = useState(true)
  const [regOptin,     setRegOptin]     = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const res  = await fetch('/api/whatsapp/meta-templates')
        const data = await res.json() as { templates?: { name: string; status: string; language: string; components?: { type: string; text?: string }[] }[]; error?: string }
        if (!res.ok || data.error) { setMetaTmpls([]); return }
        const approved = (data.templates ?? [])
          .filter(t => t.status === 'APPROVED')
          .map(t => ({
            name:     t.name,
            language: t.language,
            bodyText: t.components?.find(c => c.type === 'BODY')?.text ?? '',
          }))
        setMetaTmpls(approved)
      } catch { setMetaTmpls([]) }
      finally { setLoadingT(false) }
    })()
  }, [])

  const selected = metaTmpls?.[tmplIdx] ?? null

  async function handleSend() {
    setError(null)
    if (!phone.trim()) { setError('Informe o telefone do contato'); return }
    if (!selected)     { setError('Selecione um template'); return }
    setSending(true)
    try {
      await onStart(phone.trim(), unitId, selected.name, selected.language, [], regOptin, selected.bodyText)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao iniciar conversa')
    } finally { setSending(false) }
  }

  const noTmpls = !loadingT && (metaTmpls ?? []).length === 0

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,44,61,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 440, maxWidth: '94vw', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: '#25402C', margin: 0 }}>Nova conversa</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9AA79C', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>

        <label style={{ fontSize: 11, fontWeight: 700, color: '#9AA79C', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Telefone (DDD + número)</label>
        <input
          type="tel"
          placeholder="Ex: 11999998888"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          style={{ width: '100%', border: '1.5px solid #EBE7DA', borderRadius: 10, padding: '9px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 16, color: '#25402C' }}
        />

        <label style={{ fontSize: 11, fontWeight: 700, color: '#9AA79C', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Template de abertura</label>
        {loadingT ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <div style={{ width: 16, height: 16, border: '2px solid rgba(62,152,73,0.2)', borderTopColor: '#3E9849', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            <span style={{ fontSize: 12, color: '#9AA79C' }}>Carregando templates aprovados…</span>
          </div>
        ) : noTmpls ? (
          <p style={{ fontSize: 12, color: '#9AA79C', marginBottom: 16 }}>
            Nenhum template aprovado na Meta. Acesse <strong>Configurações → Templates</strong> e aguarde a aprovação.
          </p>
        ) : (
          <>
            <select
              value={tmplIdx}
              onChange={e => setTmplIdx(Number(e.target.value))}
              style={{ width: '100%', border: '1.5px solid #EBE7DA', borderRadius: 10, padding: '9px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 12, background: '#fff', color: '#25402C', cursor: 'pointer' }}
            >
              {(metaTmpls ?? []).map((t, i) => <option key={`${t.name}-${t.language}`} value={i}>{t.name} ({t.language})</option>)}
            </select>
            {selected?.bodyText && (
              <div style={{ background: '#E8F4E6', border: '1px solid #CDE8CB', borderRadius: 10, padding: '10px 13px', marginBottom: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#3E9849', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prévia</p>
                <p style={{ fontSize: 13, color: '#25402C', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{selected.bodyText}</p>
              </div>
            )}
          </>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={regOptin} onChange={e => setRegOptin(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: '#3E9849', flexShrink: 0, cursor: 'pointer' }} />
          <span style={{ fontSize: 12, color: '#71856F', lineHeight: 1.4 }}>
            Registrar autorização WhatsApp para este contato
          </span>
        </label>

        {error && <p style={{ fontSize: 12, color: '#E53E3E', marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', fontSize: 13, border: '1px solid #EBE7DA', borderRadius: 10, cursor: 'pointer', background: '#fff', color: '#71856F', fontWeight: 600 }}>Cancelar</button>
          <button onClick={handleSend} disabled={sending || noTmpls || loadingT}
            style={{ flex: 2, padding: '10px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 10,
              cursor: sending || noTmpls || loadingT ? 'default' : 'pointer',
              background: sending || noTmpls || loadingT ? '#EBE7DA' : '#25D366',
              color: sending || noTmpls || loadingT ? '#9AA79C' : '#fff', transition: 'all 0.15s' }}>
            {sending ? 'Enviando…' : 'Iniciar conversa'}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
