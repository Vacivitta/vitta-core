'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import Drawer from '@/components/ui/Drawer'
import type {
  Profile, Product, QuoteTemplate, Quote, QuoteStatus, QuoteItem, QuoteWithItems, PacoteOpcao,
} from '@/types/database'
import { QUOTE_STATUS_LABELS, PRODUCT_TIPO_LABELS, PACOTE_DEFAULTS } from '@/types/database'

const PdfButton = dynamic(
  () => import('@/components/orcamento/PdfButton'),
  {
    ssr: false,
    loading: () => (
      <button className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 border border-[#EBE7DA] text-[#9AA79C] rounded-xl">
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

function patientName(q: { lead: PatientOption | null; paciente_nome?: string | null }): string {
  if (q.paciente_nome?.trim()) return q.paciente_nome.trim()
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
  initialPatient?: PatientOption | null
  onClose:         () => void
  onSaved:         (q: QuoteRow, isNew: boolean) => void
}

function QuoteModal({ editing, unitId, userId, products, templates, leads, initialPatient, onClose, onSaved }: ModalProps) {
  const supabase = createClient()

  const [tab, setTab] = useState<'paciente' | 'itens' | 'config'>('paciente')

  // Paciente
  const [search,       setSearch]       = useState('')
  const [selectedLead, setSelectedLead] = useState<PatientOption | null>(
    editing?.lead ?? initialPatient ?? null
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

  const [pacienteNome,          setPacienteNome]          = useState(editing?.paciente_nome ?? '')
  const [usarNomePersonalizado, setUsarNomePersonalizado] = useState(!!(editing?.paciente_nome?.trim()))

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

  const selectedPatient = selectedLead

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
      lead_id:         selectedLead?.id ?? null,
      template_id:     templateId || null,
      status,
      motivo_recusa:   status === 'recusado' ? motivoRecusa.trim() : null,
      responsavel_id:  userId,
      validade_ate:    validadeAte || null,
      observacoes:     observacoes.trim() || null,
      total_calculado: total,
      pacote_ativo:    pacoteAtivo,
      pacote_opcoes:   pacoteAtivo ? pacoteOpcoes : null,
      paciente_nome:   usarNomePersonalizado && pacienteNome.trim() ? pacienteNome.trim() : null,
    }

    const SELECT = '*, lead:leads(nome,sobrenome,telefone), template:quote_templates(*)'

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
      paciente_nome:   usarNomePersonalizado && pacienteNome.trim() ? pacienteNome.trim() : null,
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
    <Drawer
      open={true}
      onClose={onClose}
      title={editing ? `Orçamento #${String(editing.numero ?? 0).padStart(4, '0')}` : 'Novo orçamento'}
      width={620}
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            {quoteForPdf && (
              <PdfButton quote={quoteForPdf} label="Prévia PDF" variant="preview" />
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              style={{ border: '1px solid #EBE7DA', borderRadius: '11px', padding: '11px 22px', fontSize: '13.5px', fontWeight: 700, color: '#35543B', cursor: 'pointer', background: 'transparent', transition: 'background 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#FBFAF4')}
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
      }
    >
      {editing && <div className="mb-3"><StatusBadge status={editing.status} /></div>}

      {/* Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '26px', marginBottom: 16, borderBottom: '1px solid #EBE7DA' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              fontSize: '12.5px', fontWeight: tab === t.id ? 800 : 700, paddingBottom: '12px', cursor: 'pointer',
              color: tab === t.id ? '#3E9849' : '#9AA79C',
              background: 'none', border: 'none', borderBottom: tab === t.id ? '3px solid #3E9849' : '3px solid transparent',
              transition: 'color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div>

          {/* ── Paciente ── */}
          {tab === 'paciente' && (
            <div className="space-y-3">
              {/* Selected patient display */}
              {selectedPatient && (
                <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: '#E8F4E6', border: '1px solid #CDE8CB' }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: '#D6EBD2' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#35853F' }}>{selectedPatient.nome[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: '13px', fontWeight: 800, color: '#25402C' }}>
                      {selectedPatient.nome}{selectedPatient.sobrenome ? ` ${selectedPatient.sobrenome}` : ''}
                    </p>
                    {selectedPatient.telefone && (
                      <p style={{ fontSize: '11.5px', color: '#35853F' }}>{selectedPatient.telefone}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedLead(null)}
                    className="text-xs text-[#9AA79C] hover:text-[#3E9849] shrink-0"
                  >
                    Trocar
                  </button>
                </div>
              )}

              {/* Nome no orçamento */}
              {selectedPatient && (
                <div style={{ background: '#FBFAF4', border: '1px solid #EBE7DA', borderRadius: 12, padding: '14px 16px' }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#5B7A8A', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Nome no orçamento
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#25402C' }}>
                      <input
                        type="radio"
                        checked={!usarNomePersonalizado}
                        onChange={() => { setUsarNomePersonalizado(false); setPacienteNome('') }}
                        style={{ accentColor: 'var(--color-brand)' }}
                      />
                      Nome do cliente ({selectedPatient.nome}{selectedPatient.sobrenome ? ` ${selectedPatient.sobrenome}` : ''})
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#25402C' }}>
                      <input
                        type="radio"
                        checked={usarNomePersonalizado}
                        onChange={() => setUsarNomePersonalizado(true)}
                        style={{ accentColor: 'var(--color-brand)' }}
                      />
                      Outro nome (filho, dependente...)
                    </label>
                    {usarNomePersonalizado && (
                      <input
                        type="text"
                        value={pacienteNome}
                        onChange={e => setPacienteNome(e.target.value)}
                        placeholder="Ex: Maria Silva (filha)"
                        autoFocus
                        style={{ marginTop: 4, padding: '8px 12px', fontSize: 13, border: '1.5px solid var(--color-brand)', borderRadius: 8, outline: 'none', color: '#25402C', background: '#fff' }}
                      />
                    )}
                  </div>
                </div>
              )}

              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9AA79C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Buscar paciente por nome ou telefone..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm border border-[#EBE7DA] rounded-xl focus:outline-none focus:ring-0"
                />
              </div>

              <div className="space-y-1 max-h-56 overflow-y-auto">
                {filteredPatients.length === 0 ? (
                  <p className="text-xs text-[#9AA79C] text-center py-4">
                    Nenhum paciente encontrado
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
                          isSelected ? 'bg-[#E8F4E6] border border-[#CDE8CB]' : 'hover:bg-[#FBFAF4] border border-transparent'
                        }`}
                      >
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={isSelected ? { background: 'var(--color-brand)', color: '#fff' } : { background: 'var(--color-track)', color: 'var(--color-text)' }}
                        >
                          {p.nome[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#25402C] truncate">
                            {p.nome}{p.sobrenome ? ` ${p.sobrenome}` : ''}
                          </p>
                          {p.telefone && <p className="text-xs text-[#9AA79C]">{p.telefone}</p>}
                        </div>
                        {isSelected && (
                          <svg className="w-4 h-4 text-[#3E9849] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                <div className="text-center py-8 text-sm text-[#9AA79C]">Carregando itens...</div>
              ) : (
                <>
                  {/* Product search */}
                  <div className="relative">
                    <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9AA79C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Buscar e adicionar vacina ou serviço..."
                      value={prodSearch}
                      onChange={e => setProdSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-sm border border-[#EBE7DA] rounded-xl focus:outline-none focus:ring-0"
                    />
                  </div>

                  {/* Product list — always visible, filtered by search */}
                  <div className="border border-[#EBE7DA] rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                    {filteredProducts.map(p => (
                        <button
                          key={p.id}
                          onClick={() => addProduct(p)}
                          className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-[#FBFAF4] border-b border-[#EBE7DA] last:border-0 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[#25402C] truncate">{p.nome}</p>
                            <p className="text-xs text-[#9AA79C]">
                              {p.tipo ? PRODUCT_TIPO_LABELS[p.tipo] : ''}
                              {p.descricao ? ` · ${p.descricao.slice(0, 40)}` : ''}
                            </p>
                          </div>
                          <span className="text-sm font-semibold text-[#35543B] shrink-0 ml-4">
                            {p.valor_venda != null ? fmtBRL.format(p.valor_venda) : '—'}
                          </span>
                        </button>
                    ))}
                  </div>

                  {/* Items list */}
                  {items.length === 0 ? (
                    <div className="text-center py-8 text-[#9AA79C]">
                      <svg className="w-8 h-8 mx-auto mb-2 text-[#9AA79C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                          <div key={item.key} className="border border-[#EBE7DA] rounded-xl p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-[#25402C] truncate">{item.nome_snapshot}</p>
                                <p className="text-xs text-[#9AA79C]">{fmtBRL.format(item.valor_snapshot)} / un.</p>
                              </div>
                              <button
                                onClick={() => removeItem(item.key)}
                                className="p-1 text-[#9AA79C] hover:text-[#C05B3A] transition-colors shrink-0"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-[#71856F] uppercase tracking-wide">Qtd</span>
                                <input
                                  type="number" min="1"
                                  value={item.quantidade}
                                  onChange={e => setQty(item.key, parseInt(e.target.value) || 1)}
                                  className="w-14 text-sm border border-[#EBE7DA] rounded-lg px-2 py-1 text-center focus:outline-none focus:ring-0"
                                />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-[#71856F] uppercase tracking-wide">Desc.</span>
                                <div className="relative">
                                  <input
                                    type="number" min="0" max="100" step="0.5"
                                    value={item.desconto}
                                    onChange={e => setDisc(item.key, parseFloat(e.target.value) || 0)}
                                    className="w-16 text-sm border border-[#EBE7DA] rounded-lg pl-2 pr-5 py-1 text-center focus:outline-none focus:ring-0"
                                  />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#9AA79C]">%</span>
                                </div>
                              </div>
                              <span className="ml-auto text-sm font-semibold text-[#25402C]">
                                {fmtBRL.format(vf)}
                              </span>
                            </div>
                          </div>
                        )
                      })}

                      {/* Total */}
                      <div className="flex items-center justify-between px-3 py-2 bg-[#FBFAF4] rounded-xl">
                        <span className="text-xs font-semibold text-[#71856F] uppercase tracking-wide">Total</span>
                        <span className="text-base font-bold text-[#25402C]">{fmtBRL.format(total)}</span>
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
                  <label className="block text-xs font-medium text-[#71856F] mb-2">Template de PDF</label>
                  <div className="space-y-2">
                    <button
                      onClick={() => setTemplateId('')}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                        !templateId ? 'border-[#CDE8CB] bg-[#E8F4E6]' : 'border-gray-200 hover:bg-[#FBFAF4]'
                      }`}
                    >
                      <div className="w-6 h-6 bg-[#EBE7DA] rounded-lg flex items-center justify-center shrink-0">
                        <svg className="w-3.5 h-3.5 text-[#71856F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#25402C]">Padrão do sistema</p>
                        <p className="text-xs text-[#9AA79C]">Layout limpo sem imagens personalizadas</p>
                      </div>
                      {!templateId && (
                        <svg className="w-4 h-4 text-[#3E9849] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    {templates.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setTemplateId(t.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                          templateId === t.id ? 'border-[#CDE8CB] bg-[#E8F4E6]' : 'border-gray-200 hover:bg-[#FBFAF4]'
                        }`}
                      >
                        <div
                          className="w-6 h-6 rounded-lg shrink-0"
                          style={{ background: `linear-gradient(135deg, ${t.cor_primaria}, ${t.cor_secundaria})` }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#25402C]">{t.nome}</p>
                          <p className="text-xs text-[#9AA79C]">
                            {t.nome_clinica ?? ''}
                            {t.is_default ? ' · Padrão' : ''}
                          </p>
                        </div>
                        {templateId === t.id && (
                          <svg className="w-4 h-4 text-[#3E9849] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  <label className="block text-xs font-medium text-[#71856F] mb-1">Status</label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as QuoteStatus)}
                    className="w-full text-sm border border-[#EBE7DA] rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-0"
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
                  <label className="block text-xs font-medium text-[#71856F] mb-1">
                    Motivo da recusa <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={motivoRecusa}
                    onChange={e => setMotivoRecusa(e.target.value)}
                    rows={3}
                    placeholder="Descreva o motivo..."
                    className="w-full text-sm border border-[#EBE7DA] rounded-xl px-3 py-2 focus:outline-none focus:ring-0 resize-none"
                  />
                </div>
              )}

              {/* Validade */}
              <div>
                <label className="block text-xs font-medium text-[#71856F] mb-1">
                  Válido até <span className="text-[#9AA79C]">(opcional)</span>
                </label>
                <input
                  type="date"
                  value={validadeAte}
                  onChange={e => setValidadeAte(e.target.value)}
                  className="w-full text-sm border border-[#EBE7DA] rounded-xl px-3 py-2 focus:outline-none focus:ring-0"
                />
              </div>

              {/* Observações */}
              <div>
                <label className="block text-xs font-medium text-[#71856F] mb-1">
                  Observações <span className="text-[#9AA79C]">(opcional)</span>
                </label>
                <textarea
                  value={observacoes}
                  onChange={e => setObservacoes(e.target.value)}
                  rows={3}
                  placeholder="Anotações internas, condições especiais..."
                  className="w-full text-sm border border-[#EBE7DA] rounded-xl px-3 py-2 focus:outline-none focus:ring-0 resize-none"
                />
              </div>

              {/* Pacote de pagamento */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs font-medium text-[#35543B]">Pacote de Pagamento</p>
                    <p className="text-[11px] text-[#9AA79C] mt-0.5">Exibe opções de desconto por forma de pagamento</p>
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
                  <div className="border border-[#EBE7DA] rounded-xl overflow-hidden">
                    <div className="flex items-center px-3 py-2 bg-[#FBFAF4] border-b border-gray-200">
                      <span className="text-[10px] text-[#9AA79C] flex-1">Grupo</span>
                      <span className="text-[10px] text-[#9AA79C] w-14 text-center">Desconto</span>
                      <span className="text-[10px] text-[#9AA79C] w-24 text-right">Total</span>
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
    </Drawer>
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
    <div className="px-3 py-3 border-b border-[#EBE7DA] last:border-0">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-[#25402C]">{opcao.label}</span>
          <p className="text-[11px] text-[#9AA79C] mt-0.5">{opcao.metodos.join(' · ')}</p>
        </div>
        <div className="relative flex items-center shrink-0">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={opcao.desconto}
            onChange={e => onDesconto(opcao.id, parseFloat(e.target.value) || 0)}
            className="w-14 text-xs text-center border border-[#EBE7DA] rounded-lg pl-2 pr-5 py-1 focus:outline-none focus:ring-0"
          />
          <span className="absolute right-2 text-[11px] text-[#9AA79C]">%</span>
        </div>
        <span className="text-xs font-semibold text-[#35853F] w-24 text-right shrink-0">
          {valorFinal != null ? fmtBRL.format(valorFinal) : '—'}
        </span>
      </div>
    </div>
  )
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, valueColor }: {
  label: string; value: string | number; valueColor?: string
}) {
  return (
    <div>
      <p style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
      <p style={{ fontSize: '18px', fontWeight: 900, marginTop: 2, color: valueColor ?? '#25402C' }}>{value}</p>
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
  const [initialPatient, setInitialPatient] = useState<PatientOption | null>(null)
  useEffect(() => {
    if (initialQuoteId) {
      const q = initialQuotes.find(x => x.id === initialQuoteId) ?? null
      if (q) { setEditing(q); setModalOpen(true) }
      return
    }
    if (initialLeadId) {
      const p = leads.find(l => l.id === initialLeadId)
      if (p) { setInitialPatient(p); setModalOpen(true) }
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
      <header className="bg-white shrink-0" style={{ padding: '16px 26px', borderBottom: '1px solid #E9E5D8' }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontSize: '19px', fontWeight: 900, color: '#25402C' }}>Orçamentos</h1>
            <p style={{ fontSize: '11.5px', fontWeight: 600, color: '#9AA79C', marginTop: 2 }}>Crie e acompanhe propostas de vacinas e serviços</p>
          </div>
          <button
            onClick={() => { setEditing(null); setModalOpen(true) }}
            className="flex items-center gap-1.5 text-white transition-colors"
            style={{ fontSize: '13.5px', fontWeight: 800, padding: '10px 20px', borderRadius: '999px', background: '#3E9849', boxShadow: '0 5px 14px -6px rgba(62,152,73,0.55)' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#35853F')}
            onMouseLeave={e => (e.currentTarget.style.background = '#3E9849')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Novo orçamento
          </button>
        </div>
      </header>

      {/* Stats */}
      <div className="bg-white flex items-center gap-6 shrink-0" style={{ padding: '12px 26px', borderBottom: '1px solid #E9E5D8' }}>
        <StatCard label="Total" value={stats.total} />
        <div style={{ width: 1, height: 32, background: '#EBE7DA' }} />
        <StatCard label="Rascunhos" value={stats.rascunhos} />
        <div style={{ width: 1, height: 32, background: '#EBE7DA' }} />
        <StatCard label="Aguardando" value={stats.enviados} valueColor="#1E86C0" />
        <div style={{ width: 1, height: 32, background: '#EBE7DA' }} />
        <StatCard label="Aceitos" value={stats.aceitos} valueColor="#3E9849" />
        <div style={{ width: 1, height: 32, background: '#EBE7DA' }} />
        <StatCard
          label="Valor aceito"
          value={stats.totalAceito > 0 ? fmtBRL.format(stats.totalAceito) : '—'}
          valueColor={stats.totalAceito > 0 ? '#3E9849' : '#9AA79C'}
        />
      </div>

      {/* Filters */}
      <div className="bg-white flex items-center gap-3 shrink-0 flex-wrap" style={{ padding: '10px 26px', borderBottom: '1px solid #E9E5D8' }}>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#9AA79C' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar paciente ou nº…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="focus:outline-none"
            style={{ paddingLeft: 32, paddingRight: 14, paddingBlock: 7, border: '1px solid #EBE7DA', borderRadius: '999px', fontSize: '12.5px', fontWeight: 600, color: '#35543B', width: 260 }}
          />
        </div>
        <select
          value={filterSt}
          onChange={e => setFilterSt(e.target.value as QuoteStatus | 'todos')}
          className="focus:outline-none"
          style={{ border: '1px solid #EBE7DA', borderRadius: '999px', padding: '7px 12px', fontSize: '12.5px', fontWeight: 700, color: '#71856F', background: '#fff', cursor: 'pointer' }}
        >
          <option value="todos">Todos os status</option>
          {(Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map(s => (
            <option key={s} value={s}>{QUOTE_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <span className="ml-auto" style={{ fontSize: '11.5px', fontWeight: 700, color: '#9AA79C' }}>
          {filtered.length} orçamento{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <main className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="flex items-center justify-center mb-4" style={{ width: 64, height: 64, borderRadius: '50%', background: '#F1EFE5' }}>
              <svg className="w-8 h-8" style={{ color: '#9AA79C' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#71856F' }}>Nenhum orçamento encontrado</p>
            <p style={{ fontSize: '11.5px', color: '#9AA79C', marginTop: 4 }}>
              Clique em &ldquo;Novo orçamento&rdquo; para começar
            </p>
          </div>
        ) : (
          <table className="w-full" style={{ fontSize: '13px' }}>
            <thead className="sticky top-0" style={{ background: '#FBFAF4', borderBottom: '1px solid #EBE7DA' }}>
              <tr>
                <th className="text-left uppercase tracking-wide px-6 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Nº</th>
                <th className="text-left uppercase tracking-wide px-4 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Paciente</th>
                <th className="text-center uppercase tracking-wide px-4 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Status</th>
                <th className="text-right uppercase tracking-wide px-4 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Total</th>
                <th className="text-left uppercase tracking-wide px-4 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Data</th>
                <th className="text-right uppercase tracking-wide px-6 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y bg-white" style={{ borderColor: '#EBE7DA' }}>
              {filtered.map(q => (
                <tr
                  key={q.id}
                  className="transition-colors"
                  onMouseEnter={e => (e.currentTarget.style.background = '#FBFAF4')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td className="px-6 py-3.5">
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#9AA79C' }}>
                      #{String(q.numero ?? 0).padStart(4, '0')}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="rounded-full flex items-center justify-center shrink-0" style={{ width: 30, height: 30, background: '#D6EBD2' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#35853F' }}>{patientName(q)[0]?.toUpperCase()}</span>
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#25402C' }}>{patientName(q)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <StatusBadge status={q.status} />
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span style={{ fontWeight: 800, color: '#25402C' }}>
                      {q.total_calculado != null
                        ? fmtBRL.format(q.total_calculado)
                        : <span style={{ color: '#9AA79C' }}>—</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span style={{ fontSize: '12px', color: '#9AA79C' }}>{fmtDate(q.criado_em)}</span>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => { setEditing(q); setModalOpen(true) }}
                        title="Editar"
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: '#9AA79C' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#3E9849'; e.currentTarget.style.background = '#E8F4E6' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.background = '' }}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleCopyLink(q)}
                        title={copiedId === q.id ? 'Link copiado!' : 'Copiar link do paciente'}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: copiedId === q.id ? '#3E9849' : '#9AA79C', background: copiedId === q.id ? '#E8F4E6' : '' }}
                        onMouseEnter={e => { if (copiedId !== q.id) { e.currentTarget.style.color = '#3E9849'; e.currentTarget.style.background = '#E8F4E6' } }}
                        onMouseLeave={e => { if (copiedId !== q.id) { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.background = '' } }}
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
                          className="p-1.5 rounded-lg transition-colors disabled:opacity-40"
                          style={{ color: '#9AA79C' }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#C05B3A'; e.currentTarget.style.background = '#F9E7E0' }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.background = '' }}
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
