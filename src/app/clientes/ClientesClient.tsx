'use client'

import { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useProfile } from '@/hooks/useProfile'
import type { Lead, Unit } from '@/types/database'

interface Profile { id: string; full_name: string }

interface Props {
  initialClients:  Lead[]
  initialError:    string | null
  profiles:        Profile[]
  units:           Pick<Unit, 'id' | 'nome'>[]
  defaultFunnelId: string | null
  defaultStageId:  string | null
}

const EMPTY_FORM = {
  nome: '', sobrenome: '', telefone: '', email: '',
  cpf: '', data_nascimento: '', observacoes_cli: '',
}

export default function ClientesClient({
  initialClients, initialError, units, defaultFunnelId, defaultStageId,
}: Props) {
  const supabase    = createClient()
  const { profile } = useProfile()

  const [clients,    setClients]    = useState<Lead[]>(initialClients)
  const [fetchError, setFetchError] = useState<string | null>(initialError)
  const [search,     setSearch]     = useState('')
  const [modal,      setModal]      = useState<'create' | 'edit' | null>(null)
  const [selected,   setSelected]   = useState<Lead | null>(null)
  const [form,       setForm]       = useState({ ...EMPTY_FORM })
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [deleting,   setDeleting]   = useState<string | null>(null)
  const [dupWarning, setDupWarning] = useState<Lead | null>(null)

  // Realtime: mantém lista sincronizada com outros abas/sessões
  useEffect(() => {
    const channel = supabase
      .channel('clientes-leads')
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'leads',
        filter: 'is_converted=eq.true',
      }, payload => {
        if (payload.eventType === 'INSERT') {
          setClients(prev => [payload.new as Lead, ...prev])
        } else if (payload.eventType === 'UPDATE') {
          setClients(prev => prev.map(c => c.id === (payload.new as Lead).id ? payload.new as Lead : c))
        } else if (payload.eventType === 'DELETE') {
          setClients(prev => prev.filter(c => c.id !== (payload.old as Lead).id))
        }
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [supabase])

  // Detecta duplicatas: leads com mesmo telefone, email ou CPF
  const duplicateGroups = useMemo(() => {
    const groups: Lead[][] = []
    const seen = new Set<string>()
    for (const c of clients) {
      if (seen.has(c.id)) continue
      const matches = clients.filter(x =>
        x.id !== c.id && (
          (c.telefone && x.telefone && c.telefone.replace(/\D/g,'') === x.telefone.replace(/\D/g,'')) ||
          (c.email    && x.email    && c.email.toLowerCase() === x.email.toLowerCase()) ||
          (c.cpf      && x.cpf      && c.cpf.replace(/\D/g,'') === x.cpf.replace(/\D/g,''))
        )
      )
      if (matches.length > 0) {
        const group = [c, ...matches]
        group.forEach(x => seen.add(x.id))
        groups.push(group)
      }
    }
    return groups
  }, [clients])

  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

  const filtered = useMemo(() => {
    const q = norm(search)
    if (!q) return clients
    return clients.filter(c => {
      const nome      = norm(c.nome)
      const sobrenome = norm(c.sobrenome ?? '')
      const fullName  = sobrenome ? `${nome} ${sobrenome}` : nome
      return fullName.includes(q) ||
        nome.includes(q) ||
        sobrenome.includes(q) ||
        (c.telefone ?? '').includes(q) ||
        norm(c.email ?? '').includes(q) ||
        (c.cpf ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, ''))
    })
  }, [clients, search])

  function openCreate() {
    setForm({ ...EMPTY_FORM })
    setSelected(null)
    setError('')
    setModal('create')
  }

  function openEdit(c: Lead) {
    setForm({
      nome:            c.nome,
      sobrenome:       c.sobrenome       ?? '',
      telefone:        c.telefone        ?? '',
      email:           c.email           ?? '',
      cpf:             c.cpf             ?? '',
      data_nascimento: c.data_nascimento ?? '',
      observacoes_cli: c.observacoes_cli ?? '',
    })
    setSelected(c)
    setError('')
    setModal('edit')
  }

  async function handleSave(force = false) {
    if (!form.nome.trim()) { setError('Nome é obrigatório.'); return }

    if (modal === 'create' && !force) {
      const tel   = form.telefone.replace(/\D/g, '')
      const email = form.email.trim().toLowerCase()
      const cpf   = form.cpf.replace(/\D/g, '')
      const potential = clients.find(c =>
        (tel   && c.telefone && c.telefone.replace(/\D/g,'') === tel)   ||
        (email && c.email    && c.email.toLowerCase()         === email) ||
        (cpf   && c.cpf      && c.cpf.replace(/\D/g,'')       === cpf)
      )
      if (potential) { setDupWarning(potential); return }
    }

    setDupWarning(null)
    setSaving(true)
    setError('')

    const payload = {
      nome:            form.nome.trim(),
      sobrenome:       form.sobrenome.trim()       || null,
      telefone:        form.telefone.trim()        || null,
      email:           form.email.trim()           || null,
      cpf:             form.cpf.trim()             || null,
      data_nascimento: form.data_nascimento        || null,
      observacoes_cli: form.observacoes_cli.trim() || null,
    }

    try {
      if (modal === 'create') {
        const unitId = units[0]?.id ?? profile?.unit_id
        if (!defaultFunnelId || !defaultStageId) {
          setError('Nenhum funil configurado. Configure um funil ativo nas configurações.')
          setSaving(false)
          return
        }
        const { data, error: err } = await supabase
          .from('leads')
          .insert({
            ...payload,
            unit_id:      unitId,
            funnel_id:    defaultFunnelId,
            stage_id:     defaultStageId,
            is_converted: true,
          })
          .select('*')
          .single()
        if (err) throw err
        setClients(prev => [data as Lead, ...prev])
      } else if (selected) {
        const { data, error: err } = await supabase
          .from('leads')
          .update(payload)
          .eq('id', selected.id)
          .select('*')
          .single()
        if (err) throw err
        setClients(prev => prev.map(c => c.id === selected.id ? data as Lead : c))
      }
      setModal(null)
    } catch {
      setError('Erro ao salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    const { error } = await supabase.from('leads').delete().eq('id', id)
    if (!error) setClients(prev => prev.filter(c => c.id !== id))
    setDeleting(null)
  }

  function fmt(v: string | null) {
    if (!v) return '—'
    try { return format(new Date(v), 'dd/MM/yyyy', { locale: ptBR }) } catch { return v }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-app)' }}>
      {/* Header */}
      <div className="bg-white px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Clientes</h1>
            <p className="text-sm text-gray-500 mt-0.5">{clients.length} cliente{clients.length !== 1 ? 's' : ''} cadastrado{clients.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-xl transition-colors"
            style={{ background: 'var(--color-brand)', boxShadow: 'var(--shadow-btn-primary)' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Novo cliente
          </button>
        </div>

        <div className="relative mt-3">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nome, telefone, e-mail ou CPF..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
          />
        </div>
      </div>

      {/* Erro de carregamento */}
      {fetchError && (
        <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>Erro ao carregar clientes: {fetchError}</span>
          <button onClick={() => setFetchError(null)} className="text-red-400 hover:text-red-600 ml-2">✕</button>
        </div>
      )}

      {/* Banner de duplicatas detectadas */}
      {duplicateGroups.length > 0 && (
        <div className="mx-6 mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">
              {duplicateGroups.length} grupo{duplicateGroups.length !== 1 ? 's' : ''} de possíveis clientes duplicados
            </p>
            <ul className="mt-1 space-y-0.5">
              {duplicateGroups.map((group, i) => (
                <li key={i} className="text-xs text-amber-700">
                  {group.map(c => `${c.nome}${c.sobrenome ? ' ' + c.sobrenome : ''}`).join(' · ')}
                  {group[0].telefone && <span className="text-amber-500 ml-1">({group[0].telefone})</span>}
                  <button
                    onClick={() => {
                      const toDelete = group[group.length - 1]
                      void handleDelete(toDelete.id)
                    }}
                    className="ml-2 underline hover:no-underline text-amber-600"
                  >
                    Remover duplicata
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm">{search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado ainda'}</p>
            {!search && (
              <button onClick={openCreate} className="mt-3 text-sm text-blue-500 hover:underline">
                Cadastrar primeiro cliente
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: '#F7FAFC', borderBottom: '1px solid var(--color-border)' }}>
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Telefone</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">E-mail</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">CPF</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cadastro</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y bg-white" style={{ borderColor: 'var(--color-border)' }}>
              {filtered.map(c => (
                <tr
                  key={c.id}
                  className="transition-colors"
                  onMouseEnter={e => (e.currentTarget.style.background = '#F8FBFD')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--color-brand-subtle)' }}>
                        <span className="text-xs font-semibold" style={{ color: 'var(--color-brand)' }}>{c.nome[0].toUpperCase()}</span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{c.nome}{c.sobrenome ? ` ${c.sobrenome}` : ''}</p>
                        {c.observacoes_cli && (
                          <p className="text-xs text-gray-400 truncate max-w-xs">{c.observacoes_cli}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.telefone ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.cpf ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmt(c.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {c.telefone && (
                        <a
                          href={`/atendimento?numero=${c.telefone.replace(/\D/g, '')}`}
                          className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Ir para atendimento"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                        </a>
                      )}
                      <a
                        href={`/orcamento?lead_id=${c.id}`}
                        className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Orçamentos"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </a>
                      <button
                        onClick={() => openEdit(c)}
                        className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Editar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(c.id)}
                        disabled={deleting === c.id}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                        title="Excluir"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal confirmação de duplicata */}
      {dupWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Possível duplicata detectada</p>
                <p className="text-xs text-gray-500 mt-0.5">Já existe um cliente com dados similares:</p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-700">
              <p className="font-medium">{dupWarning.nome}{dupWarning.sobrenome ? ` ${dupWarning.sobrenome}` : ''}</p>
              {dupWarning.telefone && <p className="text-xs text-gray-500">{dupWarning.telefone}</p>}
              {dupWarning.email    && <p className="text-xs text-gray-500">{dupWarning.email}</p>}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDupWarning(null)}
                className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => { setDupWarning(null); void handleSave(true) }}
                className="flex-1 px-4 py-2 text-sm bg-amber-500 text-white font-medium rounded-xl hover:bg-amber-600 transition-colors"
              >
                Criar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal create/edit */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">
                {modal === 'create' ? 'Novo cliente' : 'Editar cliente'}
              </h2>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome *"             value={form.nome}            onChange={v => setForm(f => ({ ...f, nome: v }))} />
                <Field label="Sobrenome"           value={form.sobrenome}       onChange={v => setForm(f => ({ ...f, sobrenome: v }))} />
                <Field label="Telefone"            value={form.telefone}        onChange={v => setForm(f => ({ ...f, telefone: v }))} />
                <Field label="E-mail"              value={form.email}           onChange={v => setForm(f => ({ ...f, email: v }))} type="email" />
                <Field label="CPF"                 value={form.cpf}             onChange={v => setForm(f => ({ ...f, cpf: v }))} placeholder="000.000.000-00" />
                <Field label="Data de nascimento"  value={form.data_nascimento} onChange={v => setForm(f => ({ ...f, data_nascimento: v }))} type="date" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Observações</label>
                <textarea
                  value={form.observacoes_cli}
                  onChange={e => setForm(f => ({ ...f, observacoes_cli: e.target.value }))}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => handleSave()}
                disabled={saving}
                className="px-4 py-2 text-sm text-white font-medium rounded-xl disabled:opacity-50 transition-colors"
                style={{ background: 'var(--color-brand)', boxShadow: 'var(--shadow-btn-primary)' }}
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}
