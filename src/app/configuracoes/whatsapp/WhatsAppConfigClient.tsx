'use client'

import { useState, useCallback } from 'react'

interface Unit { id: string; nome: string }

interface UnitConfig {
  phone_number_id: string
  access_token:    string
  waba_id:         string
  display_phone:   string
  configured:      boolean
  updated_at:      string | null
}

interface TestResult {
  success: boolean
  phone?:  string
  name?:   string
  quality?: string
  error?:  string
}

interface Props {
  webhookUrl:         string
  isMultiUnit:        boolean
  units:              Unit[]
  globalVerifyToken:  string
  initialUnitId:      string
  initialConfig:      UnitConfig
}

export default function WhatsAppConfigClient({
  webhookUrl,
  isMultiUnit,
  units,
  globalVerifyToken,
  initialUnitId,
  initialConfig,
}: Props) {
  const [selectedUnitId, setSelectedUnitId] = useState(initialUnitId)
  const [config, setConfig]                 = useState<UnitConfig>(initialConfig)
  const [verifyToken, setVerifyToken]       = useState(globalVerifyToken)
  const [loadingUnit, setLoadingUnit]       = useState(false)

  const [saving, setSaving]               = useState(false)
  const [savingToken, setSavingToken]     = useState(false)
  const [savedToken, setSavedToken]       = useState(false)
  const [testing, setTesting]             = useState(false)
  const [saved, setSaved]                 = useState(false)
  const [saveError, setSaveError]         = useState('')
  const [testResult, setTestResult]       = useState<TestResult | null>(null)
  const [tokenEditing, setTokenEditing]   = useState(false)

  const selectedUnit = units.find(u => u.id === selectedUnitId)

  // Quando troca de unidade, carrega a config dela
  const handleUnitChange = useCallback(async (unitId: string) => {
    setSelectedUnitId(unitId)
    setLoadingUnit(true)
    setSaved(false)
    setSaveError('')
    setTestResult(null)
    setTokenEditing(false)

    const res  = await fetch(`/api/whatsapp/config?unit_id=${unitId}`)
    const data = await res.json() as UnitConfig & { verify_token?: string }
    setConfig({
      phone_number_id: data.phone_number_id ?? '',
      access_token:    data.access_token    ?? '',
      waba_id:         data.waba_id         ?? '',
      display_phone:   data.display_phone   ?? '',
      configured:      data.configured      ?? false,
      updated_at:      data.updated_at      ?? null,
    })
    // Atualiza o verify_token global apenas se esta unidade tiver um
    if (data.verify_token) setVerifyToken(data.verify_token)
    setLoadingUnit(false)
  }, [])

  function updateConfig(key: keyof UnitConfig, value: string) {
    setConfig(c => ({ ...c, [key]: value }))
    setSaved(false)
    setSaveError('')
    setTestResult(null)
  }

  async function handleSaveToken() {
    if (!verifyToken.trim()) return
    setSavingToken(true)
    setSavedToken(false)
    setSaveError('')
    try {
      const res = await fetch('/api/whatsapp/config', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: selectedUnitId || null, verify_token: verifyToken }),
      })
      const text = await res.text()
      const json = text ? JSON.parse(text) as { success?: boolean; error?: string } : {}
      if (json.success) {
        setSavedToken(true)
      } else {
        setSaveError(json.error ?? `Erro ${res.status} ao salvar token`)
      }
    } catch (err) {
      setSaveError('Não foi possível salvar. Verifique a conexão e tente novamente.')
      console.error('[handleSaveToken]', err)
    } finally {
      setSavingToken(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setSaveError('')
    try {
      const res = await fetch('/api/whatsapp/config', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id:         selectedUnitId || null,
          phone_number_id: config.phone_number_id,
          access_token:    config.access_token,
          verify_token:    verifyToken,
          waba_id:         config.waba_id,
          display_phone:   config.display_phone,
        }),
      })
      const text = await res.text()
      const json = text ? JSON.parse(text) as { success?: boolean; error?: string } : {}
      if (json.success) {
        setSaved(true)
        setTokenEditing(false)
        setConfig(c => ({ ...c, configured: true }))
      } else {
        setSaveError(json.error ?? `Erro ${res.status} ao salvar`)
      }
    } catch (err) {
      setSaveError('Não foi possível salvar. Verifique a conexão e tente novamente.')
      console.error('[handleSave]', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    const res = await fetch('/api/whatsapp/config', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone_number_id: config.phone_number_id,
        access_token:    config.access_token,
      }),
    })
    const json = await res.json() as TestResult
    setTesting(false)
    setTestResult(json)
    if (json.success && json.phone) {
      setConfig(c => ({ ...c, display_phone: json.phone ?? c.display_phone }))
    }
  }

  function copyToClipboard(text: string) { navigator.clipboard.writeText(text) }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', fontSize: 14,
    border: '1.5px solid #EBE7DA', borderRadius: 10, outline: 'none',
    color: '#25402C', background: '#FBFAF4', fontFamily: 'inherit',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 13, fontWeight: 600, color: '#35543B', marginBottom: 6,
  }
  const hintStyle: React.CSSProperties = { fontSize: 12, color: '#9AA79C', marginTop: 4 }
  const focusOn  = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = '#3E9849' }
  const focusOff = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = '#EBE7DA' }

  const canTest = !!(config.phone_number_id && config.access_token && !config.access_token.includes('•'))

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '32px 24px' }}>

      {/* ── Cabeçalho ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: '#E9F7EE', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#25D366">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>
          </svg>
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#25402C', margin: 0 }}>Integração WhatsApp</h1>
          <p style={{ fontSize: 13, color: '#8A98A6', margin: 0 }}>API Oficial do Meta (Cloud API)</p>
        </div>
      </div>

      {/* ── Seletor de unidade (admin / gestor_vacivitta) ───────────────────── */}
      {isMultiUnit && (
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Unidade</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {units.map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => handleUnitChange(u.id)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 99,
                  border: '1.5px solid',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  borderColor:  u.id === selectedUnitId ? '#3E9849' : '#EBE7DA',
                  background:   u.id === selectedUnitId ? '#E8F4E6'  : '#fff',
                  color:        u.id === selectedUnitId ? '#3E9849'  : '#35543B',
                }}
              >
                {u.nome}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Webhook URL (global, sempre visível) ──────────────────────────── */}
      <div style={{ background: '#F0F7EF', border: '1.5px solid #EBE7DA', borderRadius: 14, padding: '16px 20px', marginBottom: 20 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#3E9849', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 4px' }}>
          URL do Webhook — Global
        </p>
        <p style={{ fontSize: 12, color: '#5B7A8A', margin: '0 0 10px' }}>
          Registre esta URL uma única vez no Meta para todas as unidades.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code style={{ flex: 1, fontSize: 13, color: '#25402C', background: '#fff', border: '1px solid #EBE7DA', borderRadius: 8, padding: '8px 12px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
            {webhookUrl}
          </code>
          <button type="button" onClick={() => copyToClipboard(webhookUrl)}
            style={{ flexShrink: 0, padding: '8px 14px', border: '1.5px solid #EBE7DA', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#35543B' }}>
            Copiar
          </button>
        </div>
      </div>

      {/* ── Token de verificação (global, salva independente) ─────────────── */}
      <div style={{ background: '#fff', border: '1.5px solid #EBE7DA', borderRadius: 16, padding: '20px 24px', marginBottom: 20 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#8A98A6', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 14px' }}>
          Configuração Global do Webhook
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Token de verificação</label>
            <input
              type="text"
              placeholder="Ex: vitta_webhook_2024"
              value={verifyToken}
              onChange={e => { setVerifyToken(e.target.value); setSavedToken(false) }}
              style={inputStyle}
              onFocus={focusOn} onBlur={focusOff}
            />
            <p style={hintStyle}>
              Compartilhado entre todas as unidades — use o mesmo valor ao registrar o webhook no Meta.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={handleSaveToken}
              disabled={savingToken || !verifyToken.trim()}
              style={{
                padding: '9px 20px', border: '1.5px solid #3E9849', borderRadius: 10,
                background: '#E8F4E6', fontSize: 13, fontWeight: 600, color: '#3E9849',
                cursor: savingToken || !verifyToken.trim() ? 'not-allowed' : 'pointer',
                opacity: !verifyToken.trim() ? 0.5 : 1,
              }}
            >
              {savingToken ? 'Salvando…' : 'Salvar token'}
            </button>
            {savedToken && (
              <span style={{ fontSize: 13, color: '#2E8E4C', fontWeight: 600 }}>✓ Token salvo</span>
            )}
          </div>
          {saveError && !saving && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FDE8E2', color: '#C05B3A', fontSize: 13, fontWeight: 500 }}>
              {saveError}
            </div>
          )}
        </div>
      </div>

      {loadingUnit ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#9AA79C', fontSize: 14 }}>
          Carregando configuração…
        </div>
      ) : (
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Status da unidade selecionada ─────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {config.configured ? (
              <span style={{ fontSize: 12, fontWeight: 600, color: '#2E8E4C', background: '#E9F7EE', borderRadius: 99, padding: '4px 12px' }}>
                ● Conectado{selectedUnit ? ` — ${selectedUnit.nome}` : ''}
              </span>
            ) : (
              <span style={{ fontSize: 12, fontWeight: 600, color: '#8A98A6', background: '#F0F3F6', borderRadius: 99, padding: '4px 12px' }}>
                ○ Não configurado{selectedUnit ? ` — ${selectedUnit.nome}` : ''}
              </span>
            )}
          </div>

          {/* ── Campos por unidade ────────────────────────────────────────── */}
          <div style={{ background: '#fff', border: '1.5px solid #EBE7DA', borderRadius: 16, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#8A98A6', letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0 }}>
              Configuração por unidade{selectedUnit ? ` — ${selectedUnit.nome}` : ''}
            </p>

            {/* Phone Number ID */}
            <div>
              <label style={labelStyle}>Phone Number ID</label>
              <input
                type="text"
                placeholder="Ex: 123456789012345"
                required
                value={config.phone_number_id}
                onChange={e => updateConfig('phone_number_id', e.target.value)}
                style={inputStyle}
                onFocus={focusOn} onBlur={focusOff}
              />
              <p style={hintStyle}>Meta for Developers → Seu App → WhatsApp → Configuração da API</p>
            </div>

            {/* Access Token */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Access Token</label>
                {!tokenEditing && config.configured && (
                  <button type="button"
                    onClick={() => { setConfig(c => ({ ...c, access_token: '' })); setTokenEditing(true) }}
                    style={{ fontSize: 12, color: '#3E9849', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                    Substituir token
                  </button>
                )}
              </div>
              <input
                type={tokenEditing || !config.configured ? 'text' : 'password'}
                placeholder={tokenEditing || !config.configured ? 'Cole o token de acesso permanente' : '••••••••••••••••••••'}
                required
                value={config.access_token}
                onChange={e => updateConfig('access_token', e.target.value)}
                readOnly={!tokenEditing && config.configured}
                style={{ ...inputStyle, fontFamily: tokenEditing || !config.configured ? 'inherit' : 'monospace' }}
                onFocus={focusOn} onBlur={focusOff}
              />
              <p style={hintStyle}>Meta for Developers → Ferramentas → Tokens de acesso permanente</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* WABA ID */}
              <div>
                <label style={labelStyle}>WhatsApp Business Account ID</label>
                <input type="text" placeholder="Ex: 987654321098765"
                  value={config.waba_id}
                  onChange={e => updateConfig('waba_id', e.target.value)}
                  style={inputStyle} onFocus={focusOn} onBlur={focusOff}
                />
                <p style={hintStyle}>Opcional</p>
              </div>
              {/* Número de exibição */}
              <div>
                <label style={labelStyle}>Número para exibição</label>
                <input type="text" placeholder="Ex: +55 11 99999-9999"
                  value={config.display_phone}
                  onChange={e => updateConfig('display_phone', e.target.value)}
                  style={inputStyle} onFocus={focusOn} onBlur={focusOff}
                />
                <p style={hintStyle}>Preenchido automaticamente ao testar</p>
              </div>
            </div>
          </div>

          {/* ── Resultado do teste / erro / sucesso ───────────────────────── */}
          {testResult && (
            <div style={{ padding: '12px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500,
              background: testResult.success ? '#E9F7EE' : '#FDE8E2',
              color:      testResult.success ? '#2E8E4C' : '#C05B3A' }}>
              {testResult.success
                ? `✓ Conectado — ${testResult.name ?? ''} ${testResult.phone ? `(${testResult.phone})` : ''} · Qualidade: ${testResult.quality ?? '—'}`
                : `✗ ${testResult.error}`}
            </div>
          )}
          {saveError && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: '#FDE8E2', color: '#C05B3A', fontSize: 13, fontWeight: 500 }}>
              {saveError}
            </div>
          )}
          {saved && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: '#E9F7EE', color: '#2E8E4C', fontSize: 13, fontWeight: 500 }}>
              ✓ Configuração salva com sucesso
            </div>
          )}

          {/* ── Ações ────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" onClick={handleTest} disabled={testing || !canTest}
              style={{
                padding: '11px 20px', border: '1.5px solid #EBE7DA', borderRadius: 10,
                background: '#fff', fontSize: 14, fontWeight: 600, color: '#35543B',
                cursor: testing || !canTest ? 'not-allowed' : 'pointer',
                opacity: testing || !canTest ? 0.5 : 1,
              }}>
              {testing ? 'Testando...' : 'Testar conexão'}
            </button>
            <button type="submit" disabled={saving}
              style={{
                flex: 1, padding: '11px 0',
                background: saving ? '#9AA79C' : 'linear-gradient(135deg, #3E9849 0%, #2D7A34 100%)',
                color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 10,
                cursor: saving ? 'not-allowed' : 'pointer',
                boxShadow: saving ? 'none' : '0 4px 12px -4px rgba(0,152,218,0.5)',
              }}>
              {saving ? 'Salvando...' : 'Salvar configuração'}
            </button>
          </div>
        </form>
      )}

      {/* ── Guia ────────────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 24, padding: '16px 20px', background: '#F0F7EF', border: '1.5px solid #EBE7DA', borderRadius: 14 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#5B7A8A', margin: '0 0 8px' }}>Como configurar</p>
        <ol style={{ fontSize: 12, color: '#8A98A6', margin: 0, paddingLeft: 18, lineHeight: 2 }}>
          <li>Crie um app no <strong style={{ color: '#35543B' }}>Meta for Developers</strong> e adicione o produto WhatsApp</li>
          <li>Registre o webhook com a URL acima e defina o <strong style={{ color: '#35543B' }}>Token de verificação</strong> (use o mesmo aqui)</li>
          <li>Para cada unidade: selecione-a, informe o <strong style={{ color: '#35543B' }}>Phone Number ID</strong> e o <strong style={{ color: '#35543B' }}>Access Token</strong></li>
          <li>Clique em <strong style={{ color: '#35543B' }}>Testar conexão</strong> e depois <strong style={{ color: '#35543B' }}>Salvar</strong></li>
        </ol>
      </div>

      {config.updated_at && (
        <p style={{ textAlign: 'center', fontSize: 12, color: '#9AA79C', marginTop: 16 }}>
          Última atualização: {new Date(config.updated_at).toLocaleString('pt-BR')}
        </p>
      )}
    </div>
  )
}
