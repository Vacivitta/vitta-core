'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import Drawer from '@/components/ui/Drawer'
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
      <div className="bg-white shrink-0" style={{ borderBottom: '1px solid #E9E5D8', padding: '16px 26px' }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 style={{ fontSize: '19px', fontWeight: 900, color: '#25402C', lineHeight: 1.3 }}>Clientes</h1>
            <p style={{ fontSize: '11.5px', fontWeight: 600, color: '#9AA79C', marginTop: '2px' }}>{clients.length} cliente{clients.length !== 1 ? 's' : ''} cadastrado{clients.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 text-white transition-colors"
            style={{ background: '#3E9849', fontSize: '13.5px', fontWeight: 800, padding: '10px 20px', borderRadius: '999px', boxShadow: '0 5px 14px -6px rgba(62,152,73,0.55)' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#35853F')}
            onMouseLeave={e => (e.currentTarget.style.background = '#3E9849')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Novo cliente
          </button>
        </div>

        <div className="relative mt-3">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#9AA79C' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nome, telefone, e-mail ou CPF..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full focus:outline-none"
            style={{ border: '1px solid #EBE7DA', borderRadius: '999px', padding: '8px 14px 8px 36px', fontSize: '12.5px', fontWeight: 600, color: '#35543B', background: 'transparent' }}
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
          <div className="flex flex-col items-center justify-center h-64" style={{ color: '#9AA79C' }}>
            <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p style={{ fontSize: '13px', fontWeight: 600 }}>{search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado ainda'}</p>
            {!search && (
              <button onClick={openCreate} className="mt-3 hover:underline" style={{ fontSize: '13px', fontWeight: 700, color: '#3E9849' }}>
                Cadastrar primeiro cliente
              </button>
            )}
          </div>
        ) : (
          <table className="w-full" style={{ fontSize: '13px' }}>
            <thead className="sticky top-0" style={{ background: '#FBFAF4', borderBottom: '1px solid #EBE7DA' }}>
              <tr>
                <th className="text-left px-6 py-3 uppercase tracking-wide" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Nome</th>
                <th className="text-left px-4 py-3 uppercase tracking-wide" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Telefone</th>
                <th className="text-left px-4 py-3 uppercase tracking-wide" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>E-mail</th>
                <th className="text-left px-4 py-3 uppercase tracking-wide" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>CPF</th>
                <th className="text-left px-4 py-3 uppercase tracking-wide" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Cadastro</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y bg-white" style={{ borderColor: '#EBE7DA' }}>
              {filtered.map(c => (
                <tr
                  key={c.id}
                  className="transition-colors"
                  onMouseEnter={e => (e.currentTarget.style.background = '#FBFAF4')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-full flex items-center justify-center shrink-0" style={{ width: 30, height: 30, background: '#D6EBD2' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#35853F' }}>{c.nome[0].toUpperCase()}</span>
                      </div>
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: 800, color: '#25402C' }}>{c.nome}{c.sobrenome ? ` ${c.sobrenome}` : ''}</p>
                        {c.observacoes_cli && (
                          <p className="truncate max-w-xs" style={{ fontSize: '10.5px', fontWeight: 600, color: '#9AA79C' }}>{c.observacoes_cli}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3" style={{ color: '#71856F' }}>{c.telefone ?? '—'}</td>
                  <td className="px-4 py-3" style={{ color: '#71856F' }}>{c.email ?? '—'}</td>
                  <td className="px-4 py-3" style={{ color: '#71856F' }}>{c.cpf ?? '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ fontSize: '12px', color: '#9AA79C' }}>{fmt(c.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {c.telefone && (
                        <a
                          href={`/atendimento?numero=${c.telefone.replace(/\D/g, '')}`}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: '#9AA79C' }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#3E9849'; e.currentTarget.style.background = '#E8F4E6' }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.background = '' }}
                          title="Ir para atendimento"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                        </a>
                      )}
                      <a
                        href={`/orcamento?lead_id=${c.id}`}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: '#9AA79C' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#3E9849'; e.currentTarget.style.background = '#E8F4E6' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.background = '' }}
                        title="Orçamentos"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </a>
                      <button
                        onClick={() => openEdit(c)}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: '#9AA79C' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#3E9849'; e.currentTarget.style.background = '#E8F4E6' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.background = '' }}
                        title="Editar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(c.id)}
                        disabled={deleting === c.id}
                        className="p-1.5 rounded-lg transition-colors disabled:opacity-40"
                        style={{ color: '#9AA79C' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#C05B3A'; e.currentTarget.style.background = '#F9E7E0' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.background = '' }}
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(37,64,44,0.35)' }}>
          <div className="bg-white w-full max-w-sm space-y-4" style={{ borderRadius: '18px', padding: '22px', boxShadow: '0 16px 40px -12px rgba(37,64,44,0.3)' }}>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center shrink-0" style={{ width: 40, height: 40, borderRadius: 12, background: '#FCF3E4' }}>
                <svg className="w-5 h-5" style={{ color: '#C87F1B' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 800, color: '#25402C' }}>Possível duplicata detectada</p>
                <p style={{ fontSize: '11.5px', fontWeight: 600, color: '#9AA79C', marginTop: 2 }}>Já existe um cliente com dados similares:</p>
              </div>
            </div>
            <div style={{ background: '#FBFAF4', borderRadius: 13, padding: '12px 14px', border: '1px solid #EBE7DA' }}>
              <p style={{ fontSize: '13px', fontWeight: 800, color: '#25402C' }}>{dupWarning.nome}{dupWarning.sobrenome ? ` ${dupWarning.sobrenome}` : ''}</p>
              {dupWarning.telefone && <p style={{ fontSize: '11.5px', color: '#9AA79C', marginTop: 2 }}>{dupWarning.telefone}</p>}
              {dupWarning.email    && <p style={{ fontSize: '11.5px', color: '#9AA79C', marginTop: 2 }}>{dupWarning.email}</p>}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDupWarning(null)}
                className="flex-1 transition-colors"
                style={{ padding: '9px 16px', fontSize: '13px', fontWeight: 700, color: '#71856F', border: '1px solid #EBE7DA', borderRadius: '999px' }}
              >
                Revisar dados
              </button>
              <button
                onClick={() => { setDupWarning(null); void handleSave(true) }}
                className="flex-1 text-white transition-colors"
                style={{ padding: '9px 16px', fontSize: '13px', fontWeight: 800, background: '#C87F1B', borderRadius: '999px' }}
              >
                Cadastrar assim mesmo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer create/edit */}
      <Drawer
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'create' ? 'Novo cliente' : 'Editar cliente'}
        width={440}
        footer={
          <>
            <button onClick={() => setModal(null)} className="transition-colors" style={{ padding: '8px 18px', fontSize: '13px', fontWeight: 700, color: '#71856F', borderRadius: '999px', border: '1px solid #EBE7DA' }}>
              Cancelar
            </button>
            <button
              onClick={() => handleSave()}
              disabled={saving}
              className="text-white disabled:opacity-50 transition-colors"
              style={{ padding: '8px 18px', fontSize: '13px', fontWeight: 800, background: '#3E9849', borderRadius: '999px', boxShadow: '0 5px 14px -6px rgba(62,152,73,0.55)' }}
            >
              {saving ? 'Salvando...' : modal === 'create' ? 'Cadastrar cliente' : 'Salvar'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nome *"             value={form.nome}            onChange={v => setForm(f => ({ ...f, nome: v }))} />
            <Field label="Sobrenome"           value={form.sobrenome}       onChange={v => setForm(f => ({ ...f, sobrenome: v }))} />
            <Field label="Telefone"            value={form.telefone}        onChange={v => setForm(f => ({ ...f, telefone: v }))} />
            <Field label="E-mail"              value={form.email}           onChange={v => setForm(f => ({ ...f, email: v }))} type="email" />
            <Field label="CPF"                 value={form.cpf}             onChange={v => setForm(f => ({ ...f, cpf: v }))} placeholder="000.000.000-00" />
            <Field label="Data de nascimento"  value={form.data_nascimento} onChange={v => setForm(f => ({ ...f, data_nascimento: v }))} type="date" />
          </div>
          <div>
            <label className="block mb-1" style={{ fontSize: '11.5px', fontWeight: 700, color: '#71856F' }}>Observações</label>
            <textarea
              value={form.observacoes_cli}
              onChange={e => setForm(f => ({ ...f, observacoes_cli: e.target.value }))}
              rows={3}
              placeholder="Alergias, preferências, histórico…"
              className="w-full resize-none focus:outline-none"
              style={{ border: '1px solid #EBE7DA', borderRadius: '11px', padding: '8px 12px', fontSize: '13px', color: '#25402C' }}
            />
          </div>
          {error && <p style={{ fontSize: '12px', fontWeight: 700, color: '#C05B3A' }}>{error}</p>}
        </div>
      </Drawer>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="block mb-1" style={{ fontSize: '11.5px', fontWeight: 700, color: '#71856F' }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full focus:outline-none"
        style={{ border: '1px solid #EBE7DA', borderRadius: '11px', padding: '8px 12px', fontSize: '13px', color: '#25402C' }}
      />
    </div>
  )
}
