'use client'

import { useState, useEffect, useMemo } from 'react'
import type { WaTemplate, WaTemplateFolder } from './wa-types'
import { createClient } from '@/lib/supabase/client'

interface Props {
  unitId:     string
  templates?: WaTemplate[]
  folders?:   WaTemplateFolder[]
  onStart:    (phone: string, unitId: string, templateName: string, language: string, components: object[], registerOptin: boolean, bodyText: string, contactName?: string) => Promise<void>
  onClose:    () => void
}

export default function NewConversationModal({ unitId, templates: templatesProp, folders: foldersProp, onStart, onClose }: Props) {
  const [phone,        setPhone]        = useState('')
  const [contactName,  setContactName]  = useState('')
  const [sending,      setSending]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [regOptin,     setRegOptin]     = useState(true)
  const [search,       setSearch]       = useState('')
  const [openFolders,  setOpenFolders]  = useState<Set<string>>(() => new Set(['__geral__']))
  const [fetchedTmpls, setFetchedTmpls] = useState<WaTemplate[] | null>(null)
  const [fetchedFolders, setFetchedFolders] = useState<WaTemplateFolder[] | null>(null)
  const [loading, setLoading] = useState(!templatesProp)

  useEffect(() => {
    if (templatesProp) return
    const supabase = createClient()
    void (async () => {
      const { data } = await supabase
        .from('wa_message_templates')
        .select('id,name,content,category,template_name,language,variable_order,header_image_url,header_type,folder_id')
        .eq('unit_id', unitId)
        .eq('ativo', true)
        .eq('category', 'meta_api')
        .order('name')
      setFetchedTmpls((data ?? []) as WaTemplate[])
      setLoading(false)
    })()
  }, [templatesProp, unitId])

  useEffect(() => {
    if (foldersProp) return
    const supabase = createClient()
    void (async () => {
      const { data } = await supabase
        .from('wa_template_folders')
        .select('id, unit_id, nome, ordem, criado_em')
        .eq('unit_id', unitId)
        .order('ordem')
        .order('nome')
      if (data) setFetchedFolders(data as WaTemplateFolder[])
    })()
  }, [foldersProp, unitId])

  const templates = templatesProp ?? fetchedTmpls ?? []
  const folders = foldersProp ?? fetchedFolders ?? []

  const metaTemplates = useMemo(() =>
    templates.filter(t => t.category === 'meta_api'),
  [templates])

  // Validação do telefone: detecta celular sem 9° dígito
  const phoneWarning = useMemo(() => {
    const digits = phone.replace(/\D/g, '')
    if (!digits) return null
    const n = digits.startsWith('55') ? digits : digits.startsWith('0') ? '55' + digits.slice(1) : '55' + digits
    // 55 + DDD(2) + 8 dígitos começando com [6-9] = celular sem 9° dígito
    if (n.startsWith('55') && n.length === 12) {
      const local = n.slice(4)
      if (/^[6-9]/.test(local)) {
        const ddd = n.slice(2, 4)
        return `Número de celular sem o 9° dígito. O formato correto é (${ddd}) 9${local.slice(0, 4)}-${local.slice(4)}`
      }
    }
    if (n.length < 12 || n.length > 13) return 'Número inválido. Informe DDD + número (ex: 34999998888)'
    return null
  }, [phone])

  const [selectedName, setSelectedName] = useState<string | null>(null)
  const selected = useMemo(() => {
    if (selectedName) return metaTemplates.find(t => t.name === selectedName) ?? metaTemplates[0] ?? null
    return metaTemplates[0] ?? null
  }, [selectedName, metaTemplates])

  const filtered = useMemo(() => {
    if (!search) return metaTemplates
    const q = search.toLowerCase()
    return metaTemplates.filter(t => t.name.toLowerCase().includes(q) || (t.content ?? '').toLowerCase().includes(q))
  }, [metaTemplates, search])

  const grouped = useMemo(() => {
    if (folders.length === 0 || search) return null
    const byFolder = new Map<string, WaTemplate[]>()
    for (const t of filtered) {
      const fk = t.folder_id ?? '__geral__'
      if (!byFolder.has(fk)) byFolder.set(fk, [])
      byFolder.get(fk)!.push(t)
    }
    const result: { key: string; label: string; items: WaTemplate[] }[] = []
    const geralItems = byFolder.get('__geral__')
    if (geralItems) result.push({ key: '__geral__', label: 'Geral', items: geralItems })
    for (const f of folders) {
      const items = byFolder.get(f.id)
      if (items) result.push({ key: f.id, label: f.nome, items })
    }
    return result
  }, [filtered, folders, search])

  function toggleFolder(key: string) {
    setOpenFolders(prev => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  function hasImageHeader(t: WaTemplate): boolean {
    return t.components?.some(c => c.type === 'HEADER' && c.format === 'IMAGE') || t.header_type === 'IMAGE' || false
  }

  function buildComponents(t: WaTemplate, name: string): object[] {
    const comps: object[] = []
    if (hasImageHeader(t) && t.header_image_url) {
      comps.push({ type: 'header', parameters: [{ type: 'image', image: { link: t.header_image_url } }] })
    }
    const bodyText = t.content ?? ''
    const varCount = (bodyText.match(/\{\{\d+\}\}/g) ?? []).length
    if (varCount > 0) {
      const now = new Date()
      const resolveVar = (id: string): string => {
        switch (id) {
          case 'nome_cliente':   return name || 'Cliente'
          case 'nome_atendente': return 'Atendente'
          case 'data':           return now.toLocaleDateString('pt-BR')
          case 'horario':        return now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          default:                return ''
        }
      }
      const order = (t.variable_order ?? []).length === varCount
        ? t.variable_order!
        : ['nome_cliente', 'nome_atendente', 'data', 'horario'].slice(0, varCount)
      const values = order.map(resolveVar)
      comps.push({ type: 'body', parameters: values.map(v => ({ type: 'text', text: v })) })
    }
    return comps
  }

  async function handleSend() {
    setError(null)
    if (!phone.trim()) { setError('Informe o telefone do contato'); return }
    if (!selected)     { setError('Selecione um template'); return }
    setSending(true)
    try {
      const components = buildComponents(selected, contactName.trim())
      const bodyText = selected.content ?? ''
      const renderedBody = bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => {
        const varCount = (bodyText.match(/\{\{\d+\}\}/g) ?? []).length
        const order = (selected.variable_order ?? []).length === varCount
          ? selected.variable_order!
          : ['nome_cliente', 'nome_atendente', 'data', 'horario'].slice(0, varCount)
        const idx = parseInt(n, 10) - 1
        const id = order[idx]
        const now = new Date()
        switch (id) {
          case 'nome_cliente':   return contactName.trim() || 'Cliente'
          case 'nome_atendente': return 'Atendente'
          case 'data':           return now.toLocaleDateString('pt-BR')
          case 'horario':        return now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          default:               return `{{${n}}}`
        }
      })
      await onStart(phone.trim(), unitId, selected.template_name ?? selected.name, selected.language ?? 'pt_BR', components, regOptin, renderedBody, contactName.trim() || undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao iniciar conversa')
    } finally { setSending(false) }
  }

  const noTmpls = metaTemplates.length === 0

  function TemplateItem({ t }: { t: WaTemplate }) {
    const isSelected = selected?.name === t.name
    const isImage = hasImageHeader(t)
    return (
      <button
        onClick={() => setSelectedName(t.name)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
          background: isSelected ? '#E8F4E6' : 'transparent',
          borderBottom: '1px solid #f5f3ed',
          transition: 'background 0.1s',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: isSelected ? 700 : 600, color: isSelected ? '#25402C' : '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.name}
            </span>
            {isImage && <span style={{ fontSize: 10 }}>🖼️</span>}
          </div>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9AA79C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.content || '(sem corpo)'}
          </p>
        </div>
        <span style={{ fontSize: 10, color: '#9AA79C', flexShrink: 0 }}>{t.language}</span>
      </button>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,44,61,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: 480, maxWidth: '94vw', maxHeight: '90vh', boxShadow: '0 16px 48px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px 0' }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: '#25402C', margin: 0 }}>Nova conversa</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9AA79C', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {/* Conteúdo com scroll */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 28px 0' }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#9AA79C', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nome do cliente</label>
          <input
            type="text"
            placeholder="Ex: Maria Silva"
            value={contactName}
            onChange={e => setContactName(e.target.value)}
            style={{ width: '100%', border: '1.5px solid #EBE7DA', borderRadius: 10, padding: '9px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 16, color: '#25402C' }}
          />

          <label style={{ fontSize: 11, fontWeight: 700, color: '#9AA79C', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Telefone (DDD + número)</label>
          <input
            type="tel"
            placeholder="Ex: 34999998888"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            style={{ width: '100%', border: `1.5px solid ${phoneWarning ? '#E53E3E' : '#EBE7DA'}`, borderRadius: 10, padding: '9px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: phoneWarning ? 4 : 16, color: '#25402C' }}
          />
          {phoneWarning && (
            <p style={{ fontSize: 11.5, color: '#E53E3E', margin: '0 0 12px', display: 'flex', alignItems: 'flex-start', gap: 4, lineHeight: 1.4 }}>
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ flexShrink: 0, marginTop: 1 }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
              {phoneWarning}
            </p>
          )}

          <label style={{ fontSize: 11, fontWeight: 700, color: '#9AA79C', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Template de abertura</label>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <div style={{ width: 16, height: 16, border: '2px solid rgba(62,152,73,0.2)', borderTopColor: '#3E9849', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              <span style={{ fontSize: 12, color: '#9AA79C' }}>Carregando templates...</span>
            </div>
          ) : noTmpls ? (
            <p style={{ fontSize: 12, color: '#9AA79C', marginBottom: 16 }}>
              Nenhum template aprovado. Acesse <strong>Configurações → Templates</strong> para criar e aguardar aprovação.
            </p>
          ) : (
            <>
              {/* Busca */}
              <input
                type="text"
                placeholder="Buscar template..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', border: '1.5px solid #EBE7DA', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 8, color: '#25402C' }}
              />

              {/* Lista com pastas */}
              <div style={{ border: '1.5px solid #EBE7DA', borderRadius: 10, maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
                {filtered.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#9AA79C', textAlign: 'center', padding: 16, margin: 0 }}>Nenhum template encontrado</p>
                ) : grouped ? (
                  grouped.map(g => (
                    <div key={g.key}>
                      <button
                        onClick={() => toggleFolder(g.key)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                          padding: '7px 14px', background: '#F8FAFB', border: 'none',
                          borderBottom: '1px solid #EBE7DA', cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <svg width="10" height="10" fill="none" stroke="#9AA79C" viewBox="0 0 24 24"
                          style={{ transform: openFolders.has(g.key) ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                        </svg>
                        <svg width="13" height="13" fill="none" stroke="#9AA79C" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#71856F', flex: 1 }}>{g.label}</span>
                        <span style={{ fontSize: 10, color: '#9AA79C' }}>{g.items.length}</span>
                      </button>
                      {openFolders.has(g.key) && g.items.map(t => (
                        <TemplateItem key={`${t.name}-${t.language}`} t={t} />
                      ))}
                    </div>
                  ))
                ) : (
                  filtered.map(t => (
                    <TemplateItem key={`${t.name}-${t.language}`} t={t} />
                  ))
                )}
              </div>

              {/* Prévia do template selecionado */}
              {selected && (
                <div style={{ background: '#E8F4E6', border: '1px solid #CDE8CB', borderRadius: 10, padding: '10px 13px', marginBottom: 16 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#3E9849', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prévia — {selected.name}</p>
                  {hasImageHeader(selected) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: '#71856F' }}>📷 Template com imagem de cabeçalho</span>
                      {!selected.header_image_url && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#E53E3E' }}>⚠ Imagem não configurada</span>
                      )}
                    </div>
                  )}
                  {selected.header_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selected.header_image_url} alt="" style={{ width: '100%', maxHeight: 120, objectFit: 'contain', borderRadius: 6, marginBottom: 6, background: '#c8e6c0' }} />
                  )}
                  {selected.content && (
                    <p style={{ fontSize: 13, color: '#25402C', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{selected.content}</p>
                  )}
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

          {error && <p style={{ fontSize: 12, color: '#E53E3E', marginBottom: 0 }}>{error}</p>}
        </div>

        {/* Botões fixos */}
        <div style={{ display: 'flex', gap: 8, padding: '12px 28px 20px', flexShrink: 0, borderTop: '1px solid #EBE7DA' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', fontSize: 13, border: '1px solid #EBE7DA', borderRadius: 10, cursor: 'pointer', background: '#fff', color: '#71856F', fontWeight: 600 }}>Cancelar</button>
          <button onClick={handleSend} disabled={sending || loading || noTmpls || !selected || !!phoneWarning}
            style={{ flex: 2, padding: '10px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 10,
              cursor: sending || loading || noTmpls || !selected || phoneWarning ? 'default' : 'pointer',
              background: sending || loading || noTmpls || !selected || phoneWarning ? '#EBE7DA' : '#25D366',
              color: sending || loading || noTmpls || !selected || phoneWarning ? '#9AA79C' : '#fff', transition: 'all 0.15s' }}>
            {sending ? 'Enviando…' : 'Iniciar conversa'}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
