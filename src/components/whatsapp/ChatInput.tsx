'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import DateTimePicker from '@/components/ui/DateTimePicker'
import { createClient } from '@/lib/supabase/client'
import type { WaTemplate, WaQuickReply, InputMode } from './wa-types'

const EmojiPicker = dynamic(() => import('@emoji-mart/react'), { ssr: false })

function Spinner({ size, color }: { size: number; color: string }) {
  return <div style={{ width: size, height: size, border: `2px solid ${color}33`, borderTopColor: color, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
}

function IconPhoto()    { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> }
function IconVideo()    { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> }
function IconAudio()    { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg> }
function IconDocument() { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> }
function IconTemplate() { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8h18M3 12h18M3 16h10" /></svg> }
function IconFlash()    { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> }
function IconClock()    { return <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onMediaUpload: (file: File, caption?: string) => void
  onTemplateSend: (t: WaTemplate) => void
  onScheduleSend: (content: string, scheduledFor: string) => void
  onScheduleTemplate: (t: WaTemplate, scheduledFor: string) => void
  templates: WaTemplate[]
  quickReplies: WaQuickReply[]
  sending: boolean
  mode: InputMode
  onModeChange: (m: InputMode) => void
  unitId: string
  onTemplatesReload: () => Promise<void>
  onQuickRepliesReload: () => void
  isOutside24hWindow: boolean
  signatureEnabled: boolean
  onToggleSignature: () => void
  signerName: string
  contactName?: string
}

export default function ChatInput({
  value, onChange, onSend, onMediaUpload, onTemplateSend,
  onScheduleSend, onScheduleTemplate, templates, quickReplies,
  sending, mode, onModeChange, unitId, onTemplatesReload, onQuickRepliesReload,
  isOutside24hWindow, signatureEnabled, onToggleSignature, signerName, contactName,
}: Props) {
  const imageRef       = useRef<HTMLInputElement>(null)
  const videoRef       = useRef<HTMLInputElement>(null)
  const audioRef       = useRef<HTMLInputElement>(null)
  const docRef         = useRef<HTMLInputElement>(null)
  const textareaRef    = useRef<HTMLTextAreaElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const cursorPosRef   = useRef<number>(0)
  const isNote         = mode === 'note'

  const [attachOpen,       setAttachOpen]       = useState(false)
  const [showEmoji,        setShowEmoji]        = useState(false)
  const [showTemplates,    setShowTemplates]     = useState(false)
  const [tmplLoading,      setTmplLoading]       = useState(false)
  const [showQuickReplies, setShowQuickReplies]  = useState(false)
  const [scheduleMode,     setScheduleMode]      = useState(false)
  const [scheduleFor,      setScheduleFor]       = useState('')
  const [scheduleTemplate, setScheduleTemplate]  = useState<WaTemplate | null>(null)
  const [tmplSearch,       setTmplSearch]        = useState('')
  const [qrFilter,         setQrFilter]          = useState('')
  const [showNewTmpl,      setShowNewTmpl]       = useState(false)
  const [newTmplName,      setNewTmplName]       = useState('')
  const [newTmplContent,   setNewTmplContent]    = useState('')
  const [previewTemplate,  setPreviewTemplate]   = useState<WaTemplate | null>(null)
  const [pendingFile,      setPendingFile]       = useState<File | null>(null)
  const [pendingCaption,   setPendingCaption]    = useState('')
  const [pendingPreview,   setPendingPreview]    = useState<string | null>(null)
  const [showNewQr,        setShowNewQr]         = useState(false)
  const [newQrShortcut,    setNewQrShortcut]     = useState('')
  const [newQrContent,     setNewQrContent]      = useState('')
  const [saving,           setSaving]            = useState(false)
  const [recording,        setRecording]         = useState(false)
  const [recordingTime,    setRecordingTime]      = useState(0)
  const mediaRecorderRef   = useRef<MediaRecorder | null>(null)
  const recordTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const supabase = createClient()

  useEffect(() => {
    if (!isNote && value.startsWith('/')) { setQrFilter(value.slice(1).toLowerCase()); setShowQuickReplies(true); setAttachOpen(false) }
    else if (showQuickReplies && !value.startsWith('/')) setShowQuickReplies(false)
  }, [value, isNote]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    if (!value) { el.style.height = 'auto'; return }
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [value])

  useEffect(() => {
    if (!showEmoji) return
    function onOutsideClick(e: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) setShowEmoji(false)
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [showEmoji])

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  function handleEmojiSelect(emoji: { native: string }) {
    const pos = cursorPosRef.current
    const newVal = value.slice(0, pos) + emoji.native + value.slice(pos)
    onChange(newVal)
    const newPos = pos + emoji.native.length
    cursorPosRef.current = newPos
    setShowEmoji(false)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newPos, newPos)
      }
    })
  }

  async function startRecording() {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      console.error('[audio] getUserMedia error:', err)
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.')
      return
    }
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : 'audio/webm;codecs=opus'
      const outMime  = mimeType === 'audio/ogg;codecs=opus' ? 'audio/ogg' : 'audio/webm'
      const ext      = mimeType === 'audio/ogg;codecs=opus' ? 'ogg'       : 'webm'
      const mr = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })
      const chunks: Blob[] = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks, { type: outMime })
        onMediaUpload(new File([blob], `audio_${Date.now()}.${ext}`, { type: outMime }))
      }
      mr.start()
      mediaRecorderRef.current = mr
      setRecording(true); setRecordingTime(0)
      recordTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch (err) {
      console.error('[audio] startRecording setup error:', err)
      stream.getTracks().forEach(t => t.stop())
      alert(`Erro ao iniciar gravação: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function stopRecording(send: boolean) {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null }
    const mr = mediaRecorderRef.current
    if (mr) {
      mediaRecorderRef.current = null
      if (!send) { mr.ondataavailable = null; mr.onstop = null; try { mr.stop() } catch {} ; mr.stream.getTracks().forEach(t => t.stop()) }
      else mr.stop()
    }
    setRecording(false); setRecordingTime(0)
  }

  function fmtRecTime(s: number) { return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}` }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    e.target.value = ''
    if (f.type.startsWith('audio/')) {
      onMediaUpload(f)
      return
    }
    setPendingFile(f)
    setPendingCaption('')
    setAttachOpen(false)
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f)
      setPendingPreview(url)
    } else {
      setPendingPreview(null)
    }
  }

  function sendPendingFile() {
    if (!pendingFile) return
    onMediaUpload(pendingFile, pendingCaption.trim() || undefined)
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(null)
    setPendingCaption('')
    setPendingPreview(null)
  }

  function cancelPendingFile() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(null)
    setPendingCaption('')
    setPendingPreview(null)
  }

  async function syncTemplates() {
    setTmplLoading(true)
    try { await onTemplatesReload() } finally { setTmplLoading(false) }
  }

  function pickTemplate(t: WaTemplate) {
    if (scheduleMode && t.category === 'meta_api') { setScheduleTemplate(t) }
    else if (!scheduleMode && t.category === 'meta_api') { setPreviewTemplate(t) }
    else { onChange(t.content); setScheduleTemplate(null) }
    setShowTemplates(false)
  }

  function renderTemplatePreview(t: WaTemplate): string {
    const now = new Date()
    const varCount = (t.content.match(/\{\{\d+\}\}/g) ?? []).length
    if (varCount === 0) return t.content
    const order = t.variable_order && t.variable_order.length === varCount
      ? t.variable_order
      : ['nome_cliente', 'nome_atendente', 'data', 'horario'].slice(0, varCount)
    const resolveVar = (id: string): string => {
      switch (id) {
        case 'nome_cliente':   return contactName ?? '—'
        case 'nome_atendente': return signerName
        case 'data':           return now.toLocaleDateString('pt-BR')
        case 'horario':        return now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        default:                return ''
      }
    }
    const values = order.map(resolveVar)
    return t.content.replace(/\{\{(\d+)\}\}/g, (_, n) => values[parseInt(n, 10) - 1] ?? `{{${n}}}`)
  }

  function pickQuickReply(qr: WaQuickReply) { onChange(qr.content); setShowQuickReplies(false) }

  async function saveTmpl() {
    if (!newTmplName.trim() || !newTmplContent.trim()) return
    setSaving(true)
    try {
      await supabase.from('wa_message_templates').insert({ unit_id: unitId, name: newTmplName.trim(), content: newTmplContent.trim(), category: 'custom' })
      setShowNewTmpl(false); setNewTmplName(''); setNewTmplContent(''); void syncTemplates()
    } finally { setSaving(false) }
  }

  async function saveQr() {
    if (!newQrShortcut.trim() || !newQrContent.trim()) return
    setSaving(true)
    try {
      const shortcut = newQrShortcut.trim().startsWith('/') ? newQrShortcut.trim() : '/' + newQrShortcut.trim()
      await supabase.from('wa_quick_replies').insert({ unit_id: unitId, shortcut, content: newQrContent.trim() })
      setShowNewQr(false); setNewQrShortcut(''); setNewQrContent(''); onQuickRepliesReload()
    } finally { setSaving(false) }
  }

  const filtTmpls = templates.filter(t => !tmplSearch || t.name.toLowerCase().includes(tmplSearch) || t.content.toLowerCase().includes(tmplSearch))
  const filtQrs   = quickReplies.filter(q => !qrFilter || q.shortcut.toLowerCase().includes(qrFilter) || q.content.toLowerCase().includes(qrFilter))

  const attachItems = [
    { key: 'image', label: 'Imagem',            icon: <IconPhoto />,    action: () => { imageRef.current?.click(); setAttachOpen(false) } },
    { key: 'video', label: 'Vídeo',             icon: <IconVideo />,    action: () => { videoRef.current?.click(); setAttachOpen(false) } },
    { key: 'audio', label: 'Áudio',             icon: <IconAudio />,    action: () => { audioRef.current?.click(); setAttachOpen(false) } },
    { key: 'doc',   label: 'Documento',         icon: <IconDocument />, action: () => { docRef.current?.click();   setAttachOpen(false) } },
    null,
    { key: 'tmpl',  label: 'Modelo de mensagem', icon: <IconTemplate />, action: () => { setShowTemplates(v => !v); setAttachOpen(false) } },
    { key: 'qr',    label: 'Mensagens rápidas',  icon: <IconFlash />,    action: () => { setShowQuickReplies(v => !v); setAttachOpen(false) } },
    { key: 'sched', label: 'Agendar mensagem',   icon: <IconClock />,    action: () => { setScheduleMode(v => !v); setAttachOpen(false) } },
  ] as const

  return (
    <div style={{ borderTop: '1px solid #F1F4F7', background: '#fff', flexShrink: 0, position: 'relative' }}>
      {/* Hidden file inputs */}
      <input ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      <input ref={videoRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFile} />
      <input ref={audioRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleFile} />
      <input ref={docRef}   type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" style={{ display: 'none' }} onChange={handleFile} />

      {/* Template popup */}
      {showTemplates && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px 12px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,0.10)', zIndex: 90, maxHeight: 320, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #F1F4F7', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <IconTemplate /> <p style={{ fontSize: 12, fontWeight: 700, color: '#0E2C3D', margin: 0, flex: 1 }}>Modelos de Mensagem</p>
            <button onClick={() => void syncTemplates()} disabled={tmplLoading} style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', opacity: tmplLoading ? 0.5 : 1 }}>{tmplLoading ? '...' : '↻ Meta'}</button>
            <button onClick={() => setShowNewTmpl(v => !v)} style={{ fontSize: 10, fontWeight: 600, color: '#0098DA', background: 'none', border: 'none', cursor: 'pointer' }}>+ Novo</button>
            <button onClick={() => setShowTemplates(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B0BEC9', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
          {showNewTmpl && (
            <div style={{ padding: '10px 14px', background: '#F0F8FF', borderBottom: '1px solid #E8EDF2', flexShrink: 0 }}>
              <input value={newTmplName} onChange={e => setNewTmplName(e.target.value)} placeholder="Nome do modelo..."
                style={{ width: '100%', fontSize: 12, border: '1px solid #B3DFFF', borderRadius: 7, padding: '5px 8px', outline: 'none', marginBottom: 6, boxSizing: 'border-box', background: '#fff' }} />
              <textarea value={newTmplContent} onChange={e => setNewTmplContent(e.target.value)} placeholder="Texto da mensagem..." rows={2}
                style={{ width: '100%', fontSize: 12, border: '1px solid #B3DFFF', borderRadius: 7, padding: '5px 8px', outline: 'none', resize: 'none', marginBottom: 6, boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff' }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => void saveTmpl()} disabled={saving} style={{ flex: 1, padding: '5px', fontSize: 11, fontWeight: 700, background: '#0098DA', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'Salvar'}</button>
                <button onClick={() => setShowNewTmpl(false)} style={{ flex: 1, padding: '5px', fontSize: 11, border: '1px solid #E8EDF2', borderRadius: 7, cursor: 'pointer', background: '#fff', color: '#5A7184' }}>Cancelar</button>
              </div>
            </div>
          )}
          <div style={{ padding: '6px 10px', flexShrink: 0 }}>
            <input value={tmplSearch} onChange={e => setTmplSearch(e.target.value.toLowerCase())} placeholder="Buscar modelo..."
              style={{ width: '100%', fontSize: 11, border: '1px solid #E8EDF2', borderRadius: 7, padding: '4px 8px', outline: 'none', boxSizing: 'border-box', background: '#F8FAFB' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {tmplLoading && <p style={{ fontSize: 12, color: '#0098DA', textAlign: 'center', padding: '12px 0', margin: 0 }}>Buscando templates Meta...</p>}
            {!tmplLoading && filtTmpls.length === 0 && <p style={{ fontSize: 12, color: '#B0BEC9', textAlign: 'center', padding: '12px 0', margin: 0 }}>Nenhum modelo — clique em ↻ Meta para sincronizar</p>}
            {filtTmpls.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 14px', borderBottom: '1px solid #F8FAFB', cursor: 'pointer' }} onClick={() => pickTemplate(t)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0E2C3D' }}>{t.name}</span>
                    {t.category === 'meta_api' && <span style={{ fontSize: 9, fontWeight: 700, background: '#E8F7EE', color: '#1D9E75', borderRadius: 4, padding: '1px 5px' }}>META</span>}
                  </div>
                  <p style={{ fontSize: 11, color: '#8FA0AF', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.category === 'meta_api' ? `Template: ${t.template_name}` : t.content}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); void supabase.from('wa_message_templates').update({ ativo: false }).eq('id', t.id).then(() => void syncTemplates()) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D1D5DB', flexShrink: 0, lineHeight: 0, padding: 2 }}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7M10 11v6m4-6v6M4 7h16M9 7V4h6v3" /></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* File preview with caption */}
      {pendingFile && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #E9E5D8', borderRadius: '12px 12px 0 0', boxShadow: '0 -4px 24px rgba(37,64,44,0.10)', zIndex: 96, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #EBE7DA', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#25402C', margin: 0, flex: 1 }}>Enviar arquivo</p>
            <button onClick={cancelPendingFile} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9AA79C', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ padding: 14 }}>
            {pendingPreview ? (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pendingPreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 10, objectFit: 'contain' }} />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#F6F4EC', borderRadius: 10, marginBottom: 10 }}>
                <svg width="20" height="20" fill="none" stroke="#6B7F6B" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /></svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#25402C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingFile.name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 10, color: '#9AA79C' }}>{(pendingFile.size / 1024).toFixed(0)} KB</p>
                </div>
              </div>
            )}
            <input
              value={pendingCaption}
              onChange={e => setPendingCaption(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPendingFile() } }}
              placeholder="Adicionar legenda (opcional)..."
              style={{ width: '100%', fontSize: 13, border: '1px solid #E9E5D8', borderRadius: 10, padding: '9px 12px', outline: 'none', background: '#F8FAFB', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={cancelPendingFile}
                style={{ flex: 1, padding: '8px', fontSize: 12, fontWeight: 600, border: '1px solid #E9E5D8', borderRadius: 10, cursor: 'pointer', background: '#fff', color: '#71856F' }}>
                Cancelar
              </button>
              <button onClick={sendPendingFile}
                style={{ flex: 2, padding: '8px', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 10, cursor: 'pointer', background: '#3E9849', color: '#fff', boxShadow: '0 4px 12px -4px rgba(62,152,73,0.4)' }}>
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template preview */}
      {previewTemplate && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #E9E5D8', borderRadius: '12px 12px 0 0', boxShadow: '0 -4px 24px rgba(37,64,44,0.10)', zIndex: 95, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #EBE7DA', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <IconTemplate />
            <p style={{ fontSize: 12, fontWeight: 700, color: '#25402C', margin: 0, flex: 1 }}>Preview do Template</p>
            <button onClick={() => setPreviewTemplate(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9AA79C', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#25402C' }}>{previewTemplate.name}</span>
              <span style={{ fontSize: 9, fontWeight: 700, background: '#E8F4E6', color: '#3E9849', borderRadius: 4, padding: '1px 5px' }}>META</span>
              {previewTemplate.language && <span style={{ fontSize: 9, color: '#9AA79C' }}>{previewTemplate.language}</span>}
            </div>
            <div style={{ padding: '10px 14px', background: '#DCF0D3', borderRadius: '16px 4px 16px 16px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, color: '#25402C', lineHeight: 1.45 }}>
              {renderTemplatePreview(previewTemplate)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => setPreviewTemplate(null)}
                style={{ flex: 1, padding: '8px', fontSize: 12, fontWeight: 600, border: '1px solid #E9E5D8', borderRadius: 10, cursor: 'pointer', background: '#fff', color: '#71856F' }}>
                Cancelar
              </button>
              <button onClick={() => { onTemplateSend(previewTemplate); setPreviewTemplate(null) }}
                style={{ flex: 2, padding: '8px', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 10, cursor: 'pointer', background: '#3E9849', color: '#fff', boxShadow: '0 4px 12px -4px rgba(62,152,73,0.4)' }}>
                Enviar template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick replies popup */}
      {showQuickReplies && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px 12px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,0.10)', zIndex: 90, maxHeight: 380, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #F1F4F7', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <IconFlash /> <p style={{ fontSize: 12, fontWeight: 700, color: '#0E2C3D', margin: 0, flex: 1 }}>Respostas Rápidas</p>
            <button onClick={() => setShowNewQr(v => !v)} style={{ fontSize: 10, fontWeight: 600, color: '#F59E0B', background: 'none', border: 'none', cursor: 'pointer' }}>+ Nova</button>
            <button onClick={() => setShowQuickReplies(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B0BEC9', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
          {showNewQr && (
            <div style={{ padding: '10px 14px', background: '#FFFBEB', borderBottom: '1px solid #FDE68A', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input value={newQrShortcut} onChange={e => setNewQrShortcut(e.target.value)} placeholder="/atalho"
                  style={{ width: 90, fontSize: 12, border: '1px solid #FDE68A', borderRadius: 7, padding: '5px 8px', outline: 'none', background: '#fff', fontFamily: 'monospace' }} />
                <input value={newQrContent} onChange={e => setNewQrContent(e.target.value)} placeholder="Conteúdo da resposta..."
                  style={{ flex: 1, fontSize: 12, border: '1px solid #FDE68A', borderRadius: 7, padding: '5px 8px', outline: 'none', background: '#fff' }} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => void saveQr()} disabled={saving} style={{ flex: 1, padding: '5px', fontSize: 11, fontWeight: 700, background: '#F59E0B', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'Salvar'}</button>
                <button onClick={() => setShowNewQr(false)} style={{ flex: 1, padding: '5px', fontSize: 11, border: '1px solid #E8EDF2', borderRadius: 7, cursor: 'pointer', background: '#fff', color: '#5A7184' }}>Cancelar</button>
              </div>
            </div>
          )}
          <div style={{ padding: '6px 10px', flexShrink: 0 }}>
            <input value={qrFilter} onChange={e => setQrFilter(e.target.value.toLowerCase())} placeholder="Buscar atalho ou digite / no chat..."
              style={{ width: '100%', fontSize: 11, border: '1px solid #E8EDF2', borderRadius: 7, padding: '4px 8px', outline: 'none', boxSizing: 'border-box', background: '#F8FAFB' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtQrs.length === 0 && <p style={{ fontSize: 12, color: '#B0BEC9', textAlign: 'center', padding: '12px 0', margin: 0 }}>{quickReplies.length === 0 ? 'Nenhuma ainda. Crie com + Nova.' : 'Nenhum resultado'}</p>}
            {filtQrs.map(qr => (
              <div key={qr.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 14px', borderBottom: '1px solid #F8FAFB', cursor: 'pointer' }} onClick={() => pickQuickReply(qr)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', fontFamily: 'monospace' }}>{qr.shortcut}</span>
                  <p style={{ fontSize: 11, color: '#5A7184', margin: '2px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>{qr.content}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); void supabase.from('wa_quick_replies').update({ ativo: false }).eq('id', qr.id).then(onQuickRepliesReload) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D1D5DB', flexShrink: 0, lineHeight: 0, padding: 2 }}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7M10 11v6m4-6v6M4 7h16M9 7V4h6v3" /></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 24h window warning */}
      {isOutside24hWindow && !isNote && (
        <div style={{ margin: '6px 12px 0', padding: '8px 12px', background: '#FFF8E1', border: '1px solid #FDE68A', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#92400E', margin: 0 }}>Janela de 24h encerrada</p>
            <p style={{ fontSize: 11, color: '#B45309', margin: '2px 0 0', lineHeight: 1.4 }}>A última mensagem do cliente foi há mais de 24h. Use um <strong>template</strong> para iniciar a conversa.</p>
          </div>
        </div>
      )}

      {/* Mode toggle + formatting toolbar */}
      <div style={{ padding: '8px 14px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={() => { onModeChange('text'); setScheduleMode(false); setScheduleTemplate(null) }}
          style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, border: 'none', cursor: 'pointer', background: !isNote ? '#0098DA' : '#F1F4F7', color: !isNote ? '#fff' : '#8FA0AF' }}>
          Mensagem
        </button>
        <button onClick={() => { onModeChange('note'); setScheduleMode(false); setScheduleTemplate(null); setAttachOpen(false); setShowTemplates(false); setShowQuickReplies(false) }}
          style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, border: 'none', cursor: 'pointer', background: isNote ? '#F59E0B' : '#F1F4F7', color: isNote ? '#fff' : '#8FA0AF' }}>
          Nota interna
        </button>
        {!isNote && (
          <>
            <div style={{ width: 1, height: 16, background: '#E8EDF2', marginInline: 2 }} />
            {([['*', 'B', 'Negrito (Ctrl+B)', { fontWeight: 700 }], ['_', 'I', 'Itálico (Ctrl+I)', { fontStyle: 'italic' as const }], ['~', 'S', 'Riscado (Ctrl+Shift+X)', { textDecoration: 'line-through' }]] as const).map(([marker, label, title, css]) => (
              <button key={marker} title={title as string}
                onClick={() => {
                  const ta = textareaRef.current; if (!ta) return
                  ta.focus()
                  const s = ta.selectionStart, end = ta.selectionEnd
                  if (s === end) { onChange(value.slice(0, s) + marker + marker + value.slice(s)); requestAnimationFrame(() => { ta.setSelectionRange(s + 1, s + 1) }); return }
                  onChange(value.slice(0, s) + marker + value.slice(s, end) + marker + value.slice(end))
                  requestAnimationFrame(() => { ta.setSelectionRange(s + 1, end + 1) })
                }}
                style={{ width: 24, height: 22, borderRadius: 4, border: '1px solid #E8EDF2', background: '#F8FAFB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#667781', ...(css as React.CSSProperties) }}
              >{label}</button>
            ))}
          </>
        )}
        {!isNote && (
          <button onClick={onToggleSignature} title={signatureEnabled ? `Assinatura ativa: "${signerName}: ..."` : 'Ativar assinatura'}
            style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 99, border: `1px solid ${signatureEnabled ? '#0098DA' : '#E8EDF2'}`, cursor: 'pointer', background: signatureEnabled ? '#EFF7FF' : '#F8FAFB', color: signatureEnabled ? '#0098DA' : '#8FA0AF', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            {signatureEnabled ? signerName : 'Assinatura'}
          </button>
        )}
      </div>

      {/* Schedule row */}
      {scheduleMode && !isNote && (
        <div style={{ padding: '6px 14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8B5CF6', flexShrink: 0 }}>Enviar em:</span>
          <div style={{ flex: 1 }}>
            <DateTimePicker value={scheduleFor} onChange={v => setScheduleFor(v)} placeholder="Selecionar data e hora" minNow />
          </div>
          <button onClick={() => { setScheduleMode(false); setScheduleFor(''); setScheduleTemplate(null) }} style={{ fontSize: 13, color: '#B0BEC9', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Template selecionado para agendamento */}
      {scheduleMode && scheduleTemplate && (
        <div style={{ margin: '6px 14px 0', padding: '8px 12px', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconTemplate />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#5B21B6', margin: 0 }}>{scheduleTemplate.name}</p>
            <p style={{ fontSize: 11, color: '#7C3AED', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scheduleTemplate.content}</p>
          </div>
          <button onClick={() => setScheduleTemplate(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7C3AED', fontSize: 14, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Input row */}
      <div style={{ padding: '6px 12px 8px', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        {!isNote && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setAttachOpen(v => !v)} title="Anexar / ferramentas"
              style={{ width: 38, height: 38, borderRadius: 10, border: `1px solid ${attachOpen ? '#0098DA' : '#E8EDF2'}`, background: attachOpen ? '#EFF7FF' : '#F8FAFB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="17" height="17" fill="none" stroke={attachOpen ? '#0098DA' : '#8FA0AF'} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            {attachOpen && (
              <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, boxShadow: '0 -4px 24px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 210, overflow: 'hidden', paddingBlock: 4 }}>
                {attachItems.map((item, i) =>
                  item === null
                    ? <div key={`div-${i}`} style={{ height: 1, background: '#F1F4F7', margin: '4px 0' }} />
                    : (
                      <button key={item.key} onClick={item.action}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 13, color: '#0E2C3D', fontWeight: 500 }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFB')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                        {item.icon}{item.label}
                      </button>
                    )
                )}
              </div>
            )}
          </div>
        )}

        {!isNote && (
          <div ref={emojiPickerRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setShowEmoji(v => !v)} title="Emoji"
              style={{ width: 38, height: 38, borderRadius: 10, border: `1px solid ${showEmoji ? '#0098DA' : '#E8EDF2'}`, background: showEmoji ? '#EFF7FF' : '#F8FAFB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="17" height="17" fill="none" stroke={showEmoji ? '#0098DA' : '#8FA0AF'} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 13.5s1.5 2 4 2 4-2 4-2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="9" cy="9.5" r="0.5" fill={showEmoji ? '#0098DA' : '#8FA0AF'} strokeWidth="1.5" />
                <circle cx="15" cy="9.5" r="0.5" fill={showEmoji ? '#0098DA' : '#8FA0AF'} strokeWidth="1.5" />
              </svg>
            </button>
            {showEmoji && (
              <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 300 }}>
                <EmojiPicker data={async () => { const r = await import('@emoji-mart/data'); return r.default }} onEmojiSelect={handleEmojiSelect} locale="pt" theme="light" previewPosition="none" skinTonePosition="none" />
              </div>
            )}
          </div>
        )}

        {recording ? (
          <>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, height: 38 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#EF4444', flexShrink: 0, animation: 'pulse 1s ease-in-out infinite' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#DC2626', fontFamily: 'monospace' }}>{fmtRecTime(recordingTime)}</span>
              <span style={{ fontSize: 11, color: '#F87171', flex: 1 }}>Gravando áudio...</span>
            </div>
            <button onClick={() => stopRecording(false)} title="Cancelar"
              style={{ width: 38, height: 38, borderRadius: 9, border: '1px solid #E8EDF2', background: '#F8FAFB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="14" height="14" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <button onClick={() => stopRecording(true)} title="Enviar áudio"
              style={{ width: 38, height: 38, borderRadius: 9, border: 'none', background: '#25D366', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="17" height="17" fill="none" stroke="#fff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </button>
          </>
        ) : (
          <>
            <textarea ref={textareaRef} value={scheduleTemplate ? '' : value} onChange={e => onChange(e.target.value)}
              disabled={!!scheduleTemplate}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !scheduleMode) { e.preventDefault(); onSend() }
                if (e.key === 'Escape') { setAttachOpen(false); setShowTemplates(false); setShowQuickReplies(false) }
                if ((e.ctrlKey || e.metaKey) && !e.altKey) {
                  const wrap = (marker: string) => {
                    e.preventDefault()
                    const ta = e.currentTarget
                    const s = ta.selectionStart, end = ta.selectionEnd
                    if (s === end) return
                    const before = value.slice(0, s), sel = value.slice(s, end), after = value.slice(end)
                    onChange(before + marker + sel + marker + after)
                    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + marker.length, end + marker.length) })
                  }
                  if (e.key === 'b') wrap('*')
                  else if (e.key === 'i') wrap('_')
                  else if (e.key === 'x' && e.shiftKey) wrap('~')
                }
              }}
              onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px' }}
              onBlur={e => { cursorPosRef.current = e.currentTarget.selectionStart ?? 0 }}
              onSelect={e => { cursorPosRef.current = e.currentTarget.selectionStart ?? 0 }}
              placeholder={isNote ? 'Nota interna (só a equipe vê)...' : scheduleTemplate ? 'Template selecionado acima — escolha a data e clique em Agendar' : scheduleMode ? 'Mensagem a agendar...' : 'Mensagem ou / para respostas rápidas...'}
              style={{ flex: 1, resize: 'none', border: `1px solid ${isNote ? '#FDE68A' : '#E8EDF2'}`, borderRadius: 10, padding: '9px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, minHeight: 38, maxHeight: 200, overflowY: 'auto', background: scheduleTemplate ? '#F1F4F7' : isNote ? '#FFFBEB' : '#F8FAFB' }}
            />
            {scheduleMode ? (
              <button onClick={() => {
                  if (!scheduleFor) return
                  if (scheduleTemplate) { onScheduleTemplate(scheduleTemplate, new Date(scheduleFor).toISOString()) }
                  else { if (!value.trim()) return; onScheduleSend(value.trim(), new Date(scheduleFor).toISOString()) }
                  setScheduleMode(false); setScheduleFor(''); setScheduleTemplate(null)
                }}
                disabled={!scheduleFor || (!value.trim() && !scheduleTemplate)}
                style={{ padding: '0 14px', height: 38, borderRadius: 9, flexShrink: 0, cursor: scheduleFor && (value.trim() || scheduleTemplate) ? 'pointer' : 'default', background: scheduleFor && (value.trim() || scheduleTemplate) ? '#8B5CF6' : '#E8EDF2', border: 'none', fontSize: 11, fontWeight: 700, color: scheduleFor && (value.trim() || scheduleTemplate) ? '#fff' : '#B0BEC9', whiteSpace: 'nowrap' }}>
                Agendar ▶
              </button>
            ) : value.trim() ? (
              <button onClick={onSend} disabled={sending}
                style={{ width: 38, height: 38, borderRadius: 9, flexShrink: 0, cursor: !sending ? 'pointer' : 'default', background: isNote ? '#F59E0B' : '#0098DA', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {sending ? <Spinner size={16} color="#fff" /> : <svg width="17" height="17" fill="none" stroke="#fff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>}
              </button>
            ) : !isNote ? (
              <button onClick={() => void startRecording()} title="Gravar áudio"
                style={{ width: 38, height: 38, borderRadius: 9, border: '1px solid #E8EDF2', background: '#F8FAFB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" fill="none" stroke="#8FA0AF" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                </svg>
              </button>
            ) : (
              <div style={{ width: 38 }} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
