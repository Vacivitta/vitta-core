'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Product, ProductTipo, Profile } from '@/types/database'
import { PRODUCT_TIPO_LABELS } from '@/types/database'

interface Props {
  currentUser:     Profile
  initialProducts: Product[]
}

type FilterTipo   = ProductTipo | 'todos'
type FilterStatus = 'ativos' | 'inativos' | 'todos'

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

// ─── Margin helpers ───────────────────────────────────────────────────────────

function calcMargem(venda: number | null, custo: number | null): number | null {
  if (!venda || venda <= 0 || custo == null) return null
  return ((venda - custo) / venda) * 100
}

function MargemBadge({ venda, custo }: { venda: number | null; custo: number | null }) {
  const m = calcMargem(venda, custo)
  if (m == null) return <span className="text-xs text-gray-300">—</span>

  const colorStyle = m >= 40
    ? { background: 'var(--color-success-subtle)', color: 'var(--color-success-text)' }
    : m >= 20
      ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent-text)' }
      : { background: 'var(--color-danger-subtle)', color: 'var(--color-danger-text)' }

  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={colorStyle}>
      {m.toFixed(1)}%
    </span>
  )
}

// ─── TIPO badge ───────────────────────────────────────────────────────────────

const TIPO_STYLES: Record<ProductTipo, React.CSSProperties> = {
  vacina:  { background: 'var(--color-brand-subtle)', color: 'var(--color-brand)' },
  pacote:  { background: 'var(--color-accent-subtle)', color: 'var(--color-accent-text)' },
  servico: { background: 'var(--color-success-subtle)', color: 'var(--color-success-text)' },
}

function TipoBadge({ tipo }: { tipo: ProductTipo | null }) {
  if (!tipo) return null
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={TIPO_STYLES[tipo]}>
      {PRODUCT_TIPO_LABELS[tipo]}
    </span>
  )
}

// ─── Modal de criar / editar ──────────────────────────────────────────────────

interface ModalForm {
  nome:        string
  tipo:        ProductTipo | ''
  descricao:   string
  valor_venda: string
  valor_custo: string
}

const EMPTY_FORM: ModalForm = {
  nome: '', tipo: '', descricao: '', valor_venda: '', valor_custo: '',
}

function parseBRL(v: string): number | null {
  const n = parseFloat(v.replace(',', '.'))
  return isNaN(n) ? null : n
}

interface ProductModalProps {
  editing:   Product | null   // null = novo produto
  onClose:   () => void
  onSaved:   (p: Product) => void
  unitId:    string | null
  canEdit:   boolean
}

function ProductModal({ editing, onClose, onSaved, unitId, canEdit }: ProductModalProps) {
  const supabase = createClient()

  const [form, setForm] = useState<ModalForm>(() =>
    editing
      ? {
          nome:        editing.nome,
          tipo:        editing.tipo ?? '',
          descricao:   editing.descricao ?? '',
          valor_venda: editing.valor_venda?.toString() ?? '',
          valor_custo: editing.valor_custo?.toString() ?? '',
        }
      : EMPTY_FORM
  )
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  const venda  = parseBRL(form.valor_venda)
  const custo  = parseBRL(form.valor_custo)
  const margem = calcMargem(venda, custo)

  function set(key: keyof ModalForm, val: string) {
    setForm(f => ({ ...f, [key]: val }))
    setError('')
  }

  async function handleSave() {
    if (!form.nome.trim())          { setError('Informe o nome da vacina.'); return }
    if (!form.tipo)                 { setError('Selecione o tipo.'); return }
    if (!form.valor_venda.trim())   { setError('Informe o valor de venda.'); return }
    if (!form.valor_custo.trim())   { setError('Informe o valor de custo.'); return }
    if (venda == null || venda <= 0) { setError('Valor de venda inválido.'); return }
    if (custo == null || custo < 0)  { setError('Valor de custo inválido.'); return }
    if (margem !== null && margem <= 0) {
      setError('Margem negativa ou zero. Ajuste os valores.')
      return
    }

    setSaving(true)
    const payload = {
      nome:        form.nome.trim(),
      tipo:        form.tipo as ProductTipo,
      descricao:   form.descricao.trim() || null,
      valor_venda: venda,
      valor_custo: custo,
      unit_id:     unitId,
    }

    const { data, error: err } = editing
      ? await supabase.from('products').update(payload).eq('id', editing.id).select().single()
      : await supabase.from('products').insert(payload).select().single()

    setSaving(false)
    if (err) { setError('Erro ao salvar. Tente novamente.'); return }
    onSaved(data as Product)
  }

  const margemColorStyle: React.CSSProperties = {
    color: margem == null
      ? 'var(--color-muted)'
      : margem >= 40 ? 'var(--color-success-text)'
      : margem >= 20 ? 'var(--color-accent-text)'
      : 'var(--color-danger-text)',
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">
            {editing ? 'Editar vacina' : 'Nova vacina'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Nome */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.nome}
              onChange={e => set('nome', e.target.value)}
              placeholder="Ex: Vacina Gripe Quadrivalente"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Tipo */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tipo <span className="text-red-500">*</span></label>
            <select
              value={form.tipo}
              onChange={e => set('tipo', e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Selecione...</option>
              <option value="vacina">Vacina</option>
              <option value="pacote">Combo</option>
              <option value="servico">Serviço</option>
            </select>
          </div>

          {/* Preços — lado a lado */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Valor de Venda <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">R$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.valor_venda}
                  onChange={e => set('valor_venda', e.target.value)}
                  placeholder="0,00"
                  className="w-full text-sm border border-gray-200 rounded-xl pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Custo Fornecedor <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">R$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.valor_custo}
                  onChange={e => set('valor_custo', e.target.value)}
                  placeholder="0,00"
                  className="w-full text-sm border border-gray-200 rounded-xl pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Margem preview */}
          {(form.valor_venda || form.valor_custo) && (
            <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-gray-500">Margem bruta estimada</span>
              <div className="text-right">
                <span className="text-sm font-bold" style={margemColorStyle}>
                  {margem != null ? `${margem.toFixed(1)}%` : '—'}
                </span>
                {venda != null && custo != null && venda > 0 && (
                  <span className="text-xs text-gray-400 ml-2">
                    ({fmtBRL.format(venda - custo)})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Margem warning */}
          {margem !== null && margem > 0 && margem < 20 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
              <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-xs text-amber-700">Margem abaixo de 20%. Considere revisar os valores.</p>
            </div>
          )}

          {/* Descrição */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Descrição <span className="text-gray-400">(opcional)</span></label>
            <textarea
              value={form.descricao}
              onChange={e => set('descricao', e.target.value)}
              rows={2}
              placeholder="Indicações, composição, fabricante..."
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !canEdit}
            className="px-4 py-2 text-xs font-medium text-white rounded-xl disabled:opacity-50 transition-colors flex items-center gap-1.5"
              style={{ background: 'var(--color-brand)', boxShadow: 'var(--shadow-btn-primary)' }}
          >
            {saving && (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {editing ? 'Salvar' : 'Criar vacina'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProdutosClient({ currentUser, initialProducts }: Props) {
  const supabase = createClient()
  const canEdit  = currentUser.perfil !== 'atendente'

  const [products,    setProducts]    = useState<Product[]>(initialProducts)
  const [search,      setSearch]      = useState('')
  const [filterTipo,  setFilterTipo]  = useState<FilterTipo>('todos')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('ativos')
  const [modalOpen,   setModalOpen]   = useState(false)
  const [editing,     setEditing]     = useState<Product | null>(null)
  const [toggling,    setToggling]    = useState<string | null>(null)

  const unitId = currentUser.unit_id

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return products.filter(p => {
      if (search) {
        const q = search.toLowerCase()
        if (!p.nome.toLowerCase().includes(q) && !p.descricao?.toLowerCase().includes(q)) return false
      }
      if (filterTipo !== 'todos' && p.tipo !== filterTipo) return false
      if (filterStatus === 'ativos'   && !p.ativo)  return false
      if (filterStatus === 'inativos' &&  p.ativo)  return false
      return true
    })
  }, [products, search, filterTipo, filterStatus])

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const ativos = products.filter(p => p.ativo)
    const margens = ativos
      .map(p => calcMargem(p.valor_venda, p.valor_custo))
      .filter((m): m is number => m !== null)
    const avgMargem = margens.length ? margens.reduce((a, b) => a + b, 0) / margens.length : null
    return { total: products.length, ativos: ativos.length, avgMargem }
  }, [products])

  // ── CRUD ───────────────────────────────────────────────────────────────────
  function handleSaved(p: Product) {
    setProducts(prev => {
      const exists = prev.find(x => x.id === p.id)
      return exists ? prev.map(x => x.id === p.id ? p : x) : [p, ...prev]
    })
    setModalOpen(false)
    setEditing(null)
  }

  async function toggleAtivo(p: Product) {
    setToggling(p.id)
    const { data } = await supabase
      .from('products')
      .update({ ativo: !p.ativo })
      .eq('id', p.id)
      .select()
      .single()
    if (data) setProducts(prev => prev.map(x => x.id === p.id ? data as Product : x))
    setToggling(null)
  }

  function openEdit(p: Product) {
    setEditing(p)
    setModalOpen(true)
  }

  function openNew() {
    setEditing(null)
    setModalOpen(true)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Catálogo de Vacinas</h1>
            <p className="text-xs text-gray-400 mt-0.5">Gerencie vacinas, pacotes e serviços com precificação e margem de lucro</p>
          </div>
          {canEdit && (
            <button
              onClick={openNew}
              className="flex items-center gap-1.5 text-sm px-3 py-2 text-white rounded-xl transition-colors font-medium"
              style={{ background: 'var(--color-brand)', boxShadow: 'var(--shadow-btn-primary)' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nova vacina
            </button>
          )}
        </div>
      </header>

      {/* ── Stats cards ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6 shrink-0">
        <StatCard label="Total cadastrado" value={stats.total} />
        <div className="w-px h-8 bg-gray-100" />
        <StatCard label="Ativos" value={stats.ativos} color="text-[#4EB46B]" />
        <div className="w-px h-8 bg-gray-100" />
        <StatCard
          label="Margem média"
          value={stats.avgMargem != null ? `${stats.avgMargem.toFixed(1)}%` : '—'}
          color={
            stats.avgMargem == null ? 'text-gray-400'
              : stats.avgMargem >= 40 ? 'text-[#4EB46B]'
              : stats.avgMargem >= 20 ? 'text-[#F39313]'
              : 'text-[#E5484D]'
          }
        />
      </div>

      {/* ── Filters ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-2.5 flex items-center gap-3 shrink-0 flex-wrap">
        {/* Search */}
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar vacina..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
          />
        </div>

        {/* Tipo filter */}
        <select
          value={filterTipo}
          onChange={e => setFilterTipo(e.target.value as FilterTipo)}
          className="text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="todos">Todos os tipos</option>
          <option value="vacina">Vacinas</option>
          <option value="pacote">Combos</option>
          <option value="servico">Serviços</option>
        </select>

        {/* Status filter */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-0.5">
          {(['ativos', 'inativos', 'todos'] as FilterStatus[]).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium capitalize ${
                filterStatus === s
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {{ ativos: 'Ativos', inativos: 'Inativos', todos: 'Todos' }[s]}
            </button>
          ))}
        </div>

        <span className="text-xs text-gray-400 ml-auto">{filtered.length} produto{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Table ── */}
      <main className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-500">Nenhuma vacina encontrada</p>
            <p className="text-xs text-gray-400 mt-1">
              {canEdit ? 'Clique em "Nova vacina" para começar' : 'Nenhuma vacina cadastrada ainda'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Produto</th>
                <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Valor Venda</th>
                <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Custo</th>
                <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Margem</th>
                <th className="text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Status</th>
                {canEdit && (
                  <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Ações</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(p => (
                <ProductRow
                  key={p.id}
                  product={p}
                  canEdit={canEdit}
                  toggling={toggling === p.id}
                  onEdit={() => openEdit(p)}
                  onToggle={() => toggleAtivo(p)}
                />
              ))}
            </tbody>
          </table>
        )}
      </main>

      {/* ── Modal ── */}
      {modalOpen && (
        <ProductModal
          editing={editing}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSaved={handleSaved}
          unitId={unitId}
          canEdit={canEdit}
        />
      )}
    </div>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function ProductRow({
  product, canEdit, toggling, onEdit, onToggle,
}: {
  product: Product
  canEdit: boolean
  toggling: boolean
  onEdit: () => void
  onToggle: () => void
}) {
  const venda = product.valor_venda
  const custo = product.valor_custo

  return (
    <tr className={`hover:bg-gray-50 transition-colors ${!product.ativo ? 'opacity-60' : ''}`}>
      {/* Nome + tipo */}
      <td className="px-6 py-3.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">{product.nome}</span>
              <TipoBadge tipo={product.tipo} />
            </div>
            {product.descricao && (
              <p className="text-xs text-gray-400 truncate max-w-xs mt-0.5">{product.descricao}</p>
            )}
          </div>
        </div>
      </td>

      {/* Valor venda */}
      <td className="px-4 py-3.5 text-right">
        <span className="text-sm font-semibold text-gray-900">
          {venda != null ? fmtBRL.format(venda) : <span className="text-gray-300">—</span>}
        </span>
      </td>

      {/* Custo */}
      <td className="px-4 py-3.5 text-right">
        <span className="text-sm text-gray-500">
          {custo != null ? fmtBRL.format(custo) : <span className="text-gray-300">—</span>}
        </span>
      </td>

      {/* Margem */}
      <td className="px-4 py-3.5 text-right">
        <div className="flex justify-end items-center gap-2">
          <MargemBadge venda={venda} custo={custo} />
          {venda != null && custo != null && (
            <span className="text-xs text-gray-400">{fmtBRL.format(venda - custo)}</span>
          )}
        </div>
      </td>

      {/* Status */}
      <td className="px-4 py-3.5 text-center">
        <span
          className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
          style={product.ativo
            ? { background: 'var(--color-success-subtle)', color: 'var(--color-success-text)' }
            : { background: 'var(--color-track)', color: 'var(--color-muted)' }
          }
        >
          {product.ativo ? 'Ativo' : 'Inativo'}
        </span>
      </td>

      {/* Ações */}
      {canEdit && (
        <td className="px-6 py-3.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={onEdit}
              title="Editar"
              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={onToggle}
              disabled={toggling}
              title={product.ativo ? 'Desativar' : 'Ativar'}
              className={`p-1.5 rounded-lg transition-colors ${
                product.ativo
                  ? 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                  : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50'
              } disabled:opacity-40`}
            >
              {toggling ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : product.ativo ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </button>
          </div>
        </td>
      )}
    </tr>
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
