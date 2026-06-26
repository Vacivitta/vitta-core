'use client'

import { useState, useMemo, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import type {
  Profile, Product, QuoteTemplate, Quote, QuoteStatus, QuoteItem, QuoteWithItems, PacoteOpcao,
} from '@/types/database'
import { QUOTE_STATUS_LABELS, PRODUCT_TIPO_LABELS, PACOTE_DEFAULTS } from '@/types/database'

const PdfButton = dynamic(
  () => import('@/components/orcamento/PdfButton'),
  {
    ssr: false,
    loading: () => (
      <button className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 border border-gray-200 text-gray-400 rounded-xl">
        PDF...
      </button>
    ),
  }
)

// ─── Exported types (used by page.tsx) ────────────────────────────────────────

export type PatientOption = {
  id:        string
  nome:      string
  sobrenome: string | null
  telefone:  string | null
}

// Keep LeadOption as alias for backwards compatibility
export type LeadOption = PatientOption

export type QuoteRow = Quote & {
  lead:     PatientOption | null
  template: QuoteTemplate | null
}

// ─── Local types ─────────────────────────────────────────────────────────────

interface ItemForm {
  key:                 string
  product_id:          string
  nome_snapshot:       string
  descricao_snapshot:  string | null
  valor_snapshot:      number
  quantidade:          number
  desconto:            number
  observacao:          string
}

interface Props {
  currentUser:    Profile
  initialQuotes:  QuoteRow[]
  products:       Product[]
  templates:      QuoteTemplate[]
  leads:          PatientOption[]
  initialLeadId?:  string | null
  initialQuoteId?: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function patientName(q: { lead: PatientOption | null }): string {
  const p = q.lead
  if (!p) return '—'
  return `${p.nome}${p.sobrenome ? ` ${p.sobrenome}` : ''}`
}

function calcValorFinal(snap: number, qty: number, disc: number): number {
  return Math.round(snap * qty * (1 - disc / 100) * 100) / 100
}

function calcTotal(items: ItemForm[]): number {
  return Math.round(
    items.reduce((s, i) => s + calcValorFinal(i.valor_snapshot, i.quantidade, i.desconto), 0) * 100
  ) / 100
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

const STATUS_CSS: Record<QuoteStatus, React.CSSProperties> = {
  rascunho:      { background: 'var(--status-rascunho-bg)',     color: 'var(--status-rascunho-text)' },
  enviado:       { background: 'var(--status-enviado-bg)',      color: 'var(--status-enviado-text)' },
  visualizado:   { background: 'var(--status-visualizado-bg)',  color: 'var(--status-visualizado-text)' },
  aceito:        { background: 'var(--status-aceito-bg)',       color: 'var(--status-aceito-text)' },
  recusado:      { background: 'var(--status-recusado-bg)',     color: 'var(--status-recusado-text)' },
  em_negociacao: { background: 'var(--color-accent-subtle)',    color: 'var(--color-accent-text)' },
  expirado:      { background: 'var(--color-track)',            color: 'var(--color-muted)' },
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  return (
    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full" style={STATUS_CSS[status]}>
      {QUOTE_STATUS_LABELS[status]}
    </span>
  )
}

// ─── QuoteModal ───────────────────────────────────────────────────────────────

interface ModalProps {
  editing:         QuoteRow | null
  unitId:          string | null
  userId:          string
  products:        Product[]
  templates:       QuoteTemplate[]
  leads:           PatientOption[]
  initialPatient?: { type: 'lead' | 'client'; patient: PatientOption } | null
  onClose:         () => void
  onSaved:         (q: QuoteRow, isNew: boolean) => void
}

function QuoteModal({ editing, unitId, userId, products, templates, leads, initialPatient, onClose, onSaved }: ModalProps) {
  const supabase = createClient()

  const [tab, setTab] = useState<'paciente' | 'itens' | 'config'>('paciente')

  // Paciente — tipo + seleção
  const [patientType,     setPatientType]     = useState<'lead' | 'client'>(
    () => editing?.lead ? 'lead' : (initialPatient?.type ?? 'lead')
  )
  const [search,          setSearch]          = useState('')
  const [selectedLead,    setSelectedLead]    = useState<PatientOption | null>(
    editing?.lead ?? (initialPatient?.type === 'lead' ? initialPatient.patient : null)
  )
  const [selectedClient,  setSelectedClient]  = useState<PatientOption | null>(
    initialPatient?.type === 'client' ? initialPatient.patient : null
  )

  // Items
  const [items,        setItems]        = useState<ItemForm[]>([])
  const [loadingItems, setLoadingItems] = useState(!!editing)
  const [prodSearch,   setProdSearch]   = useState('')

  // Config
  const [templateId,   setTemplateId]   = useState(editing?.template_id ?? '')
  const [status,       setStatus]       = useState<QuoteStatus>(editing?.status ?? 'rascunho')
  const [motivoRecusa, setMotivoRecusa] = useState(editing?.motivo_recusa ?? '')
  const [observacoes,  setObservacoes]  = useState(editing?.observacoes ?? '')
  const [validadeAte,  setValidadeAte]  = useState(editing?.validade_ate ?? '')

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const [pacoteAtivo,  setPacoteAtivo]  = useState(editing?.pacote_ativo ?? false)
  const [pacoteOpcoes, setPacoteOpcoes] = useState<PacoteOpcao[]>(
    editing?.pacote_opcoes ?? [...PACOTE_DEFAULTS]
  )

  function togglePacote(ativo: boolean) {
    setPacoteAtivo(ativo)
    if (ativo && pacoteOpcoes.length === 0) setPacoteOpcoes([...PACOTE_DEFAULTS])
  }

  function setDesconto(id: string, valor: number) {
    setPacoteOpcoes(prev => prev.map(o => o.id === id ? { ...o, desconto: Math.max(0, Math.min(100, valor)) } : o))
  }

  // Load items when editing
  useEffect(() => {
    if (!editing) { setLoadingItems(false); return }
    supabase
      .from('quote_items')
      .select('*')
      .eq('quote_id', editing.id)
      .then(({ data }) => {
        if (data) {
          setItems(data.map(i => ({
            key:                 crypto.randomUUID(),
            product_id:          i.product_id,
            nome_snapshot:       i.nome_snapshot,
            descricao_snapshot:  i.descricao_snapshot ?? null,
            valor_snapshot:      Number(i.valor_snapshot),
            quantidade:          i.quantidade,
            desconto:            Number(i.desconto),
            observacao:          i.observacao ?? '',
          })))
        }
        setLoadingItems(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = calcTotal(items)

  const filteredPatients = useMemo(() => {
    const list = leads
    const q = search.trim().toLowerCase()
    const all = q
      ? list.filter((l: PatientOption) =>
          l.nome.toLowerCase().includes(q) ||
          (l.sobrenome ?? '').toLowerCase().includes(q) ||
          (l.telefone ?? '').includes(q)
        )
      : list
    return all.slice(0, 20)
  }, [leads, search])

  const filteredProducts = useMemo(() => {
    const q = prodSearch.trim().toLowerCase()
    if (!q) return products.slice(0, 20)
    return products
      .filter(p =>
        p.nome.toLowerCase().includes(q) ||
        (p.descricao ?? '').toLowerCase().includes(q)
      )
      .slice(0, 20)
  }, [products, prodSearch])

  function addProduct(p: Product) {
    const existing = items.find(i => i.product_id === p.id)
    if (existing) {
      setItems(prev => prev.map(i =>
        i.product_id === p.id ? { ...i, quantidade: i.quantidade + 1 } : i
      ))
    } else {
      setItems(prev => [
        ...prev,
        {
          key:                 crypto.randomUUID(),
          product_id:          p.id,
          nome_snapshot:       p.nome,
          descricao_snapshot:  p.descricao ?? null,
          valor_snapshot:      p.valor_venda ?? 0,
          quantidade:          1,
          desconto:            0,
          observacao:          '',
        },
      ])
    }
    setProdSearch('')
  }

  function removeItem(key: string) {
    setItems(prev => prev.filter(i => i.key !== key))
  }

  function setQty(key: string, qty: number) {
    setItems(prev => prev.map(i => i.key === key ? { ...i, quantidade: Math.max(1, qty) } : i))
  }

  function setDisc(key: string, disc: number) {
    setItems(prev => prev.map(i =>
      i.key === key ? { ...i, desconto: Math.max(0, Math.min(100, disc)) } : i
    ))
  }

  const selectedPatient = patientType === 'lead' ? selectedLead : selectedClient

  async function handleSave() {
    if (!selectedPatient) {
      setError('Selecione um paciente na aba Paciente.')
      setTab('paciente')
      return
    }
    if (items.length === 0) {
      setError('Adicione pelo menos um item na aba Itens.')
      setTab('itens')
      return
    }
    if (status === 'recusado' && !motivoRecusa.trim()) {
      setError('Informe o motivo da recusa.')
      setTab('config')
      return
    }

    setSaving(true)
    setError('')

    const quotePayload = {
      unit_id:         unitId,
      lead_id:         patientType === 'lead'   ? selectedLead?.id   ?? null : null,
      client_id:       patientType === 'client' ? selectedClient?.id ?? null : null,
      template_id:     templateId || null,
      status,
      motivo_recusa:   status === 'recusado' ? motivoRecusa.trim() : null,
      responsavel_id:  userId,
      validade_ate:    validadeAte || null,
      observacoes:     observacoes.trim() || null,
      total_calculado: total,
      pacote_ativo:    pacoteAtivo,
      pacote_opcoes:   pacoteAtivo ? pacoteOpcoes : null,
    }

    const SELECT = '*, lead:leads(nome,sobrenome,telefone), client:clients(nome,sobrenome,telefone), template:quote_templates(*)'

    let quoteId: string
    let quoteData: QuoteRow

    if (editing) {
      const { data, error: err } = await supabase
        .from('quotes')
        .update(quotePayload)
        .eq('id', editing.id)
        .select(SELECT)
        .single()

      if (err || !data) {
        setSaving(false)
        setError(`Erro ao salvar: ${err?.message ?? 'tente novamente'}`)
        return
      }
      quoteId   = editing.id
      quoteData = data as QuoteRow

      await supabase.from('quote_items').delete().eq('quote_id', quoteId)
    } else {
      const { data, error: err } = await supabase
        .from('quotes')
        .insert(quotePayload)
        .select(SELECT)
        .single()

      if (err || !data) {
        setSaving(false)
        setError(`Erro ao criar: ${err?.message ?? 'tente novamente'}`)
        return
      }
      quoteId   = data.id
      quoteData = data as QuoteRow
    }

    const itemsPayload = items.map(i => ({
      quote_id:            quoteId,
      unit_id:             unitId,
      product_id:          i.product_id,
      nome_snapshot:       i.nome_snapshot,
      descricao_snapshot:  i.descricao_snapshot ?? null,
      valor_snapshot:      i.valor_snapshot,
      quantidade:          i.quantidade,
      desconto:            i.desconto,
      valor_final:         calcValorFinal(i.valor_snapshot, i.quantidade, i.desconto),
      observacao:          i.observacao.trim() || null,
    }))

    const { error: itemsErr } = await supabase.from('quote_items').insert(itemsPayload)
    if (itemsErr) {
      setSaving(false)
      setError(`Orçamento salvo, mas erro nos itens: ${itemsErr.message}`)
      return
    }

    // Disparar automação 'criado' via rota do servidor (mesmo caminho do aceito/recusado)
    if (!editing && quoteData.lead_id && quoteData.token_publico) {
      await fetch('/api/orcamento/respond', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token: quoteData.token_publico, status: 'criado' }),
      })
    }

    setSaving(false)
    onSaved(quoteData, !editing)
  }

  // Build QuoteWithItems for PDF preview
  const quoteForPdf = useMemo((): QuoteWithItems | null => {
    if (items.length === 0) return null
    const templateObj = templates.find(t => t.id === templateId) ?? null
    return {
      id:              editing?.id ?? 'preview',
      unit_id:         unitId ?? '',
      lead_id:         selectedLead?.id ?? editing?.lead_id ?? null,
      template_id:     templateId || null,
      numero:          editing?.numero ?? null,
      status,
      motivo_recusa:   null,
      responsavel_id:  null,
      validade_ate:    validadeAte || null,
      observacoes:     observacoes || null,
      total_calculado: total,
      token_publico:   editing?.token_publico ?? 'preview',
      enviado_em:      null,
      visualizado_em:  null,
      aceito_em:       null,
      pacote_ativo:    pacoteAtivo,
      pacote_opcoes:   pacoteAtivo ? pacoteOpcoes : null,
      criado_em:       editing?.criado_em ?? new Date().toISOString(),
      atualizado_em:   new Date().toISOString(),
      items: items.map(i => ({
        id:                  i.key,
        quote_id:            editing?.id ?? 'preview',
        unit_id:             unitId ?? '',
        product_id:          i.product_id,
        nome_snapshot:       i.nome_snapshot,
        descricao_snapshot:  i.descricao_snapshot ?? null,
        valor_snapshot:      i.valor_snapshot,
        quantidade:          i.quantidade,
        desconto:            i.desconto,
        valor_final:         calcValorFinal(i.valor_snapshot, i.quantidade, i.desconto),
        observacao:          i.observacao || null,
        criado_em:           new Date().toISOString(),
      })),
      template: templateObj,
      lead: selectedLead
        ? { nome: selectedLead.nome, sobrenome: selectedLead.sobrenome, telefone: selectedLead.telefone }
        : editing?.lead ?? null,
    }
  }, [items, templateId, templates, selectedLead, editing, unitId, status, validadeAte, observacoes, total])

  const tabs = [
    { id: 'paciente', label: 'Paciente' },
    { id: 'itens',    label: `Itens${items.length ? ` (${items.length})` : ''}` },
    { id: 'config',   label: 'Configurações' },
  ] as const

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-6" style={{ background: 'rgba(14,44,61,0.42)' }}>
      <div className="bg-white flex flex-col w-full" style={{ maxWidth: '640px', maxHeight: '88vh', borderRadius: '18px', boxShadow: '0 40px 90px -30px rgba(14,44,61,0.55)', overflow: 'hidden' }}>

        {/* Header */}
        <div className="flex items-center justify-between shrink-0" style={{ padding: '20px 24px 0' }}>
          <div>
            <h2 style={{ fontSize: '19px', fontWeight: 800, letterSpacing: '-0.01em', margin: 0, color: '#0E2C3D' }}>
              {editing
                ? `Orçamento #${String(editing.numero ?? 0).padStart(4, '0')}`
                : 'Novo orçamento'}
            </h2>
            {editing && <div className="mt-0.5"><StatusBadge status={editing.status} /></div>}
          </div>
          <button
            onClick={onClose}
            style={{ width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#8A98A6', background: 'none', border: 'none', transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#F1F4F7')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="shrink-0" style={{ display: 'flex', alignItems: 'center', gap: '26px', padding: '14px 24px 0', borderBottom: '1px solid #EDF2F6' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                fontSize: '14px', fontWeight: 700, paddingBottom: '12px', cursor: 'pointer',
                color: tab === t.id ? 'var(--color-brand)' : '#7A8694',
                background: 'none', border: 'none', borderBottom: tab === t.id ? '2px solid var(--color-brand)' : '2px solid transparent',
                transition: 'color 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '20px 24px' }}>

          {/* ── Paciente ── */}
          {tab === 'paciente' && (
            <div className="space-y-3">
              {/* Toggle Lead / Cliente */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-0.5">
                {(['lead', 'client'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => { setPatientType(type); setSearch('') }}
                    className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${
                      patientType === type
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {type === 'lead' ? 'Lead' : 'Cliente'}
                  </button>
                ))}
              </div>

              {/* Selected patient display */}
              {selectedPatient && (
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--color-brand)' }}>
                    <span className="text-xs font-bold text-white">{selectedPatient.nome[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-blue-900">
                      {selectedPatient.nome}{selectedPatient.sobrenome ? ` ${selectedPatient.sobrenome}` : ''}
                    </p>
                    {selectedPatient.telefone && (
                      <p className="text-xs text-blue-600">{selectedPatient.telefone}</p>
                    )}
                  </div>
                  <button
                    onClick={() => patientType === 'lead' ? setSelectedLead(null) : setSelectedClient(null)}
                    className="text-xs text-blue-400 hover:text-blue-600 shrink-0"
                  >
                    Trocar
                  </button>
                </div>
              )}

              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder={`Buscar ${patientType === 'lead' ? 'lead' : 'cliente'} por nome ou telefone...`}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1 max-h-56 overflow-y-auto">
                {filteredPatients.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">
                    Nenhum {patientType === 'lead' ? 'lead' : 'cliente'} encontrado
                  </p>
                ) : (
                  filteredPatients.map((p: PatientOption) => {
                    const isSelected = selectedLead?.id === p.id
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedLead(p)
                          setSearch('')
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-colors ${
                          isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
                        }`}
                      >
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={isSelected ? { background: 'var(--color-brand)', color: '#fff' } : { background: 'var(--color-track)', color: 'var(--color-text)' }}
                        >
                          {p.nome[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {p.nome}{p.sobrenome ? ` ${p.sobrenome}` : ''}
                          </p>
                          {p.telefone && <p className="text-xs text-gray-400">{p.telefone}</p>}
                        </div>
                        {isSelected && (
                          <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* ── Itens ── */}
          {tab === 'itens' && (
            <div className="space-y-3">
              {loadingItems ? (
                <div className="text-center py-8 text-sm text-gray-400">Carregando itens...</div>
              ) : (
                <>
                  {/* Product search */}
                  <div className="relative">
                    <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Buscar e adicionar vacina ou serviço..."
                      value={prodSearch}
                      onChange={e => setProdSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Product list — always visible, filtered by search */}
                  <div className="border border-gray-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                    {filteredProducts.map(p => (
                        <button
                          key={p.id}
                          onClick={() => addProduct(p)}
                          className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{p.nome}</p>
                            <p className="text-xs text-gray-400">
                              {p.tipo ? PRODUCT_TIPO_LABELS[p.tipo] : ''}
                              {p.descricao ? ` · ${p.descricao.slice(0, 40)}` : ''}
                            </p>
                          </div>
                          <span className="text-sm font-semibold text-gray-700 shrink-0 ml-4">
                            {p.valor_venda != null ? fmtBRL.format(p.valor_venda) : '—'}
                          </span>
                        </button>
                    ))}
                  </div>

                  {/* Items list */}
                  {items.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <svg className="w-8 h-8 mx-auto mb-2 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      <p className="text-sm">Clique em uma vacina acima para adicionar</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {items.map(item => {
                        const vf = calcValorFinal(item.valor_snapshot, item.quantidade, item.desconto)
                        return (
                          <div key={item.key} className="border border-gray-200 rounded-xl p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{item.nome_snapshot}</p>
                                <p className="text-xs text-gray-400">{fmtBRL.format(item.valor_snapshot)} / un.</p>
                              </div>
                              <button
                                onClick={() => removeItem(item.key)}
                                className="p-1 text-gray-300 hover:text-red-500 transition-colors shrink-0"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-gray-500 uppercase tracking-wide">Qtd</span>
                                <input
                                  type="number" min="1"
                                  value={item.quantidade}
                                  onChange={e => setQty(item.key, parseInt(e.target.value) || 1)}
                                  className="w-14 text-sm border border-gray-200 rounded-lg px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-gray-500 uppercase tracking-wide">Desc.</span>
                                <div className="relative">
                                  <input
                                    type="number" min="0" max="100" step="0.5"
                                    value={item.desconto}
                                    onChange={e => setDisc(item.key, parseFloat(e.target.value) || 0)}
                                    className="w-16 text-sm border border-gray-200 rounded-lg pl-2 pr-5 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                                </div>
                              </div>
                              <span className="ml-auto text-sm font-semibold text-gray-900">
                                {fmtBRL.format(vf)}
                              </span>
                            </div>
                          </div>
                        )
                      })}

                      {/* Total */}
                      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</span>
                        <span className="text-base font-bold text-gray-900">{fmtBRL.format(total)}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Configurações ── */}
          {tab === 'config' && (
            <div className="space-y-4">

              {/* Template selector */}
              {templates.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">Template de PDF</label>
                  <div className="space-y-2">
                    <button
                      onClick={() => setTemplateId('')}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                        !templateId ? 'border-blue-200 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="w-6 h-6 bg-gray-200 rounded-lg flex items-center justify-center shrink-0">
                        <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">Padrão do sistema</p>
                        <p className="text-xs text-gray-400">Layout limpo sem imagens personalizadas</p>
                      </div>
                      {!templateId && (
                        <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    {templates.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setTemplateId(t.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                          templateId === t.id ? 'border-blue-200 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div
                          className="w-6 h-6 rounded-lg shrink-0"
                          style={{ background: `linear-gradient(135deg, ${t.cor_primaria}, ${t.cor_secundaria})` }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{t.nome}</p>
                          <p className="text-xs text-gray-400">
                            {t.nome_clinica ?? ''}
                            {t.is_default ? ' · Padrão' : ''}
                          </p>
                        </div>
                        {templateId === t.id && (
                          <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Status — only when editing */}
              {editing && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as QuoteStatus)}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {(Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map(s => (
                      <option key={s} value={s}>{QUOTE_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Motivo recusa */}
              {status === 'recusado' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Motivo da recusa <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={motivoRecusa}
                    onChange={e => setMotivoRecusa(e.target.value)}
                    rows={3}
                    placeholder="Descreva o motivo..."
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              )}

              {/* Validade */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Válido até <span className="text-gray-400">(opcional)</span>
                </label>
                <input
                  type="date"
                  value={validadeAte}
                  onChange={e => setValidadeAte(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Observações */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Observações <span className="text-gray-400">(opcional)</span>
                </label>
                <textarea
                  value={observacoes}
                  onChange={e => setObservacoes(e.target.value)}
                  rows={3}
                  placeholder="Anotações internas, condições especiais..."
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {/* Pacote de pagamento */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs font-medium text-gray-700">Pacote de Pagamento</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Exibe opções de desconto por forma de pagamento</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePacote(!pacoteAtivo)}
                    className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
                    style={{ background: pacoteAtivo ? 'var(--color-brand)' : 'var(--color-track)' }}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      pacoteAtivo ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </button>
                </div>

                {pacoteAtivo && (
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="flex items-center px-3 py-2 bg-gray-50 border-b border-gray-200">
                      <span className="text-[10px] text-gray-400 flex-1">Grupo</span>
                      <span className="text-[10px] text-gray-400 w-14 text-center">Desconto</span>
                      <span className="text-[10px] text-gray-400 w-24 text-right">Total</span>
                    </div>
                    {pacoteOpcoes.map(opcao => (
                      <PacoteRow key={opcao.id} opcao={opcao} total={total} onDesconto={setDesconto} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mt-4">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between shrink-0" style={{ padding: '16px 24px', borderTop: '1px solid #EDF2F6' }}>
          <div className="flex items-center gap-2">
            {quoteForPdf && (
              <PdfButton quote={quoteForPdf} label="Prévia PDF" variant="preview" />
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              style={{ border: '1px solid #E1EEF7', borderRadius: '11px', padding: '11px 22px', fontSize: '13.5px', fontWeight: 700, color: '#3F5666', cursor: 'pointer', background: 'transparent', transition: 'background 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F4FAFE')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ background: 'var(--color-brand)', boxShadow: 'var(--shadow-btn-primary)', border: 'none', borderRadius: '11px', padding: '11px 24px', fontSize: '13.5px', fontWeight: 700, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: saving ? 0.6 : 1, transition: 'opacity 0.15s' }}
            >
              {saving && (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {editing ? 'Salvar' : 'Criar orçamento'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── PacoteRow ────────────────────────────────────────────────────────────────

function PacoteRow({ opcao, total, onDesconto }: {
  opcao:      PacoteOpcao
  total:      number
  onDesconto: (id: string, valor: number) => void
}) {
  const valorFinal = total > 0 ? Math.round(total * (1 - opcao.desconto / 100) * 100) / 100 : null
  const fmtBRL     = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <div className="px-3 py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-gray-800">{opcao.label}</span>
          <p className="text-[11px] text-gray-400 mt-0.5">{opcao.metodos.join(' · ')}</p>
        </div>
        <div className="relative flex items-center shrink-0">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={opcao.desconto}
            onChange={e => onDesconto(opcao.id, parseFloat(e.target.value) || 0)}
            className="w-14 text-xs text-center border border-gray-200 rounded-lg pl-2 pr-5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="absolute right-2 text-[11px] text-gray-400">%</span>
        </div>
        <span className="text-xs font-semibold text-emerald-700 w-24 text-right shrink-0">
          {valorFinal != null ? fmtBRL.format(valorFinal) : '—'}
        </span>
      </div>
    </div>
  )
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color = 'text-gray-900' }: {
  label: string; value: string | number; color?: string
}) {
  return (
    <div>
      <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OrcamentosClient({
  currentUser, initialQuotes, products, templates, leads,
  initialLeadId, initialQuoteId,
}: Props) {
  const [quotes,      setQuotes]      = useState<QuoteRow[]>(initialQuotes)
  const [search,      setSearch]      = useState('')
  const [filterSt,    setFilterSt]    = useState<QuoteStatus | 'todos'>('todos')
  const [modalOpen,   setModalOpen]   = useState(false)
  const [editing,     setEditing]     = useState<QuoteRow | null>(null)
  const [copiedId,    setCopiedId]    = useState<string | null>(null)
  const [deletingId,  setDeletingId]  = useState<string | null>(null)

  const canDelete = currentUser.perfil === 'admin' || currentUser.perfil === 'gestor_unidade' || currentUser.perfil === 'gestor_vacivitta'

  // Pré-seleciona paciente ou orçamento ao navegar com query param
  const [initialPatient, setInitialPatient] = useState<{ type: 'lead' | 'client'; patient: PatientOption } | null>(null)
  useEffect(() => {
    if (initialQuoteId) {
      const q = initialQuotes.find(x => x.id === initialQuoteId) ?? null
      if (q) { setEditing(q); setModalOpen(true) }
      return
    }
    if (initialLeadId) {
      const p = leads.find(l => l.id === initialLeadId)
      if (p) { setInitialPatient({ type: 'lead', patient: p }); setModalOpen(true) }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    return quotes.filter(q => {
      if (filterSt !== 'todos' && q.status !== filterSt) return false
      if (search.trim()) {
        const s    = search.toLowerCase()
        const name = patientName(q).toLowerCase()
        const num  = String(q.numero ?? '').padStart(4, '0')
        if (!name.includes(s) && !num.includes(s)) return false
      }
      return true
    })
  }, [quotes, search, filterSt])

  const stats = useMemo(() => {
    const aceitos     = quotes.filter(q => q.status === 'aceito')
    const rascunhos   = quotes.filter(q => q.status === 'rascunho').length
    const enviados    = quotes.filter(q => ['enviado', 'visualizado'].includes(q.status)).length
    const totalAceito = aceitos.reduce((s, q) => s + (q.total_calculado ?? 0), 0)
    return { total: quotes.length, aceitos: aceitos.length, rascunhos, enviados, totalAceito }
  }, [quotes])

  function handleSaved(q: QuoteRow, isNew: boolean) {
    setQuotes(prev => isNew ? [q, ...prev] : prev.map(x => x.id === q.id ? q : x))
    setModalOpen(false)
    setEditing(null)
  }

  async function handleDelete(q: QuoteRow) {
    if (!window.confirm(`Excluir orçamento #${String(q.numero ?? 0).padStart(4, '0')} de ${patientName(q)}? Esta ação não pode ser desfeita.`)) return
    setDeletingId(q.id)
    const supabase = createClient()
    const { error: itemsErr } = await supabase.from('quote_items').delete().eq('quote_id', q.id)
    if (itemsErr) {
      setDeletingId(null)
      alert('Erro ao excluir itens do orçamento: ' + itemsErr.message)
      return
    }
    const { error } = await supabase.from('quotes').delete().eq('id', q.id)
    setDeletingId(null)
    if (error) { alert('Erro ao excluir: ' + error.message); return }
    setQuotes(prev => prev.filter(x => x.id !== q.id))
  }

  async function handleCopyLink(q: QuoteRow) {
    const url = `${window.location.origin}/orcamento/ver/${q.token_publico}`

    if (q.status === 'rascunho') {
      const res = await fetch('/api/orcamento/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: q.token_publico, status: 'enviado' }),
      })
      if (res.ok) {
        setQuotes(prev => prev.map(x =>
          x.id === q.id ? { ...x, status: 'enviado' as QuoteStatus } : x
        ))
      }
    }

    await navigator.clipboard.writeText(url)
    setCopiedId(q.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Orçamentos</h1>
            <p className="text-xs text-gray-400 mt-0.5">Crie e gerencie propostas de vacinas e serviços</p>
          </div>
          <button
            onClick={() => { setEditing(null); setModalOpen(true) }}
            className="flex items-center gap-1.5 text-sm px-3 py-2 text-white rounded-xl transition-colors font-medium" style={{ background: 'var(--color-brand)', boxShadow: 'var(--shadow-btn-primary)' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Novo orçamento
          </button>
        </div>
      </header>

      {/* Stats */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6 shrink-0">
        <StatCard label="Total" value={stats.total} />
        <div className="w-px h-8 bg-gray-100" />
        <StatCard label="Rascunhos" value={stats.rascunhos} />
        <div className="w-px h-8 bg-gray-100" />
        <StatCard label="Aguardando" value={stats.enviados} />
        <div className="w-px h-8 bg-gray-100" />
        <StatCard label="Aceitos" value={stats.aceitos} color="text-[#4EB46B]" />
        <div className="w-px h-8 bg-gray-100" />
        <StatCard
          label="Valor aceito"
          value={stats.totalAceito > 0 ? fmtBRL.format(stats.totalAceito) : '—'}
          color={stats.totalAceito > 0 ? 'text-[#4EB46B]' : 'text-gray-400'}
        />
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-6 py-2.5 flex items-center gap-3 shrink-0 flex-wrap">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar paciente ou nº..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
          />
        </div>
        <select
          value={filterSt}
          onChange={e => setFilterSt(e.target.value as QuoteStatus | 'todos')}
          className="text-sm border border-gray-200 rounded-xl px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="todos">Todos os status</option>
          {(Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map(s => (
            <option key={s} value={s}>{QUOTE_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400 ml-auto">
          {filtered.length} orçamento{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <main className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-500">Nenhum orçamento encontrado</p>
            <p className="text-xs text-gray-400 mt-1">
              Clique em &ldquo;Novo orçamento&rdquo; para começar
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Nº</th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Paciente</th>
                <th className="text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Total</th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Data</th>
                <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(q => (
                <tr key={q.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3.5">
                    <span className="text-xs font-mono font-semibold text-gray-500">
                      #{String(q.numero ?? 0).padStart(4, '0')}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-sm font-medium text-gray-900">{patientName(q)}</span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <StatusBadge status={q.status} />
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span className="text-sm font-semibold text-gray-900">
                      {q.total_calculado != null
                        ? fmtBRL.format(q.total_calculado)
                        : <span className="text-gray-300">—</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-xs text-gray-500">{fmtDate(q.criado_em)}</span>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => { setEditing(q); setModalOpen(true) }}
                        title="Editar"
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleCopyLink(q)}
                        title={copiedId === q.id ? 'Link copiado!' : 'Copiar link do paciente'}
                        className={`p-1.5 rounded-lg transition-colors ${
                          copiedId === q.id
                            ? 'text-emerald-600 bg-emerald-50'
                            : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50'
                        }`}
                      >
                        {copiedId === q.id ? (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(q)}
                          disabled={deletingId === q.id}
                          title="Excluir orçamento"
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>

      {modalOpen && (
        <QuoteModal
          editing={editing}
          unitId={currentUser.unit_id}
          userId={currentUser.id}
          products={products}
          templates={templates}
          leads={leads}
          initialPatient={editing ? null : initialPatient}
          onClose={() => { setModalOpen(false); setEditing(null); setInitialPatient(null) }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
