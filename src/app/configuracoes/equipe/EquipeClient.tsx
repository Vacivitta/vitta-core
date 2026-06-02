'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Unit, UserPerfil } from '@/types/database'
import { PERFIL_LABELS } from '@/types/database'

interface UserProfile {
  id:         string
  full_name:  string
  email:      string | null
  perfil:     UserPerfil
  unit_id:    string | null
  ativo:      boolean
  created_at: string
  unit?:      { id: string; nome: string } | null
}

interface Props {
  initialUsers: UserProfile[]
  initialUnits: Unit[]
}

type Tab = 'usuarios' | 'unidades'

const PERFIL_OPTIONS: UserPerfil[] = ['admin', 'gestor_vacivitta', 'gestor_unidade', 'atendente']

export default function EquipeClient({ initialUsers, initialUnits }: Props) {
  const supabase = createClient()
  const [tab,   setTab]   = useState<Tab>('usuarios')
  const [users, setUsers] = useState<UserProfile[]>(initialUsers)
  const [units, setUnits] = useState<Unit[]>(initialUnits)

  // ── Estado dos modais ──────────────────────────────────────────────────────
  const [userModal,   setUserModal]   = useState<'invite' | 'edit' | null>(null)
  const [unitModal,   setUnitModal]   = useState<'create' | 'edit' | null>(null)
  const [selUser,     setSelUser]     = useState<UserProfile | null>(null)
  const [selUnit,     setSelUnit]     = useState<Unit | null>(null)
  const [saving,      setSaving]      = useState(false)
  const [formError,   setFormError]   = useState('')

  // ── Formulário de usuário ──────────────────────────────────────────────────
  const [userForm, setUserForm] = useState({
    full_name: '', email: '', perfil: 'atendente' as UserPerfil, unit_id: '',
  })

  // ── Formulário de unidade ──────────────────────────────────────────────────
  const [unitForm, setUnitForm] = useState({
    nome: '', cidade: '', estado: '', telefone: '',
  })

  // ── Usuários ───────────────────────────────────────────────────────────────
  function openInvite() {
    setUserForm({ full_name: '', email: '', perfil: 'atendente', unit_id: units[0]?.id ?? '' })
    setSelUser(null)
    setFormError('')
    setUserModal('invite')
  }

  function openEditUser(u: UserProfile) {
    setUserForm({ full_name: u.full_name, email: u.email ?? '', perfil: u.perfil, unit_id: u.unit_id ?? '' })
    setSelUser(u)
    setFormError('')
    setUserModal('edit')
  }

  async function handleSaveUser() {
    if (!userForm.full_name.trim()) { setFormError('Nome é obrigatório.'); return }
    setSaving(true); setFormError('')

    try {
      if (userModal === 'invite') {
        if (!userForm.email.trim()) { setFormError('E-mail é obrigatório.'); setSaving(false); return }
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email:     userForm.email.trim(),
            full_name: userForm.full_name.trim(),
            perfil:    userForm.perfil,
            unit_id:   userForm.unit_id || null,
          }),
        })
        const json = await res.json()
        if (!res.ok) { setFormError(json.error ?? 'Erro ao convidar.'); setSaving(false); return }
        // Recarrega lista
        const { data } = await supabase
          .from('profiles')
          .select('id, full_name, email, perfil, unit_id, ativo, created_at, unit:units(id,nome)')
          .order('full_name')
        if (data) setUsers(data as UserProfile[])
      } else if (selUser) {
        const res = await fetch(`/api/admin/users/${selUser.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: userForm.full_name.trim(),
            perfil:    userForm.perfil,
            unit_id:   userForm.unit_id || null,
          }),
        })
        if (!res.ok) { const j = await res.json(); setFormError(j.error ?? 'Erro ao salvar.'); setSaving(false); return }
        const unit = units.find(u => u.id === userForm.unit_id)
        setUsers(prev => prev.map(u => u.id === selUser.id
          ? { ...u, full_name: userForm.full_name.trim(), perfil: userForm.perfil, unit_id: userForm.unit_id || null, unit: unit ? { id: unit.id, nome: unit.nome } : null }
          : u
        ))
      }
      setUserModal(null)
    } catch {
      setFormError('Erro inesperado.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleUserAtivo(u: UserProfile) {
    await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: !u.ativo }),
    })
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, ativo: !u.ativo } : x))
  }

  // ── Unidades ───────────────────────────────────────────────────────────────
  function openCreateUnit() {
    setUnitForm({ nome: '', cidade: '', estado: '', telefone: '' })
    setSelUnit(null)
    setFormError('')
    setUnitModal('create')
  }

  function openEditUnit(u: Unit) {
    setUnitForm({ nome: u.nome, cidade: u.cidade ?? '', estado: u.estado ?? '', telefone: u.telefone ?? '' })
    setSelUnit(u)
    setFormError('')
    setUnitModal('edit')
  }

  async function handleSaveUnit() {
    if (!unitForm.nome.trim()) { setFormError('Nome é obrigatório.'); return }
    setSaving(true); setFormError('')

    const payload = {
      nome:     unitForm.nome.trim(),
      cidade:   unitForm.cidade.trim()   || null,
      estado:   unitForm.estado.trim()   || null,
      telefone: unitForm.telefone.trim() || null,
    }

    try {
      if (unitModal === 'create') {
        // Pega o tenant_id da primeira unidade
        const tenant_id = units[0]?.tenant_id
        if (!tenant_id) { setFormError('Tenant não encontrado.'); setSaving(false); return }
        const { data, error } = await supabase.from('units').insert({ ...payload, tenant_id }).select().single()
        if (error) throw error
        setUnits(prev => [...prev, data as Unit].sort((a, b) => a.nome.localeCompare(b.nome)))
      } else if (selUnit) {
        const { error } = await supabase.from('units').update(payload).eq('id', selUnit.id)
        if (error) throw error
        setUnits(prev => prev.map(u => u.id === selUnit.id ? { ...u, ...payload } : u))
      }
      setUnitModal(null)
    } catch {
      setFormError('Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleUnitAtivo(u: Unit) {
    await supabase.from('units').update({ ativo: !u.ativo }).eq('id', u.id)
    setUnits(prev => prev.map(x => x.id === u.id ? { ...x, ativo: !u.ativo } : x))
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const PERFIL_BADGE: Record<UserPerfil, string> = {
    admin:            'bg-red-100 text-red-700',
    gestor_vacivitta: 'bg-purple-100 text-purple-700',
    gestor_unidade:   'bg-indigo-100 text-indigo-700',
    atendente:        'bg-blue-100 text-blue-700',
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <h1 className="text-lg font-semibold text-gray-900">Equipe</h1>
        <p className="text-sm text-gray-500 mt-0.5">Gerencie usuários e unidades da sua organização</p>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 border-b border-gray-200 -mb-4">
          {([['usuarios', 'Usuários'], ['unidades', 'Unidades']] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
              <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">
                {key === 'usuarios' ? users.length : units.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">

        {/* ── USUÁRIOS ──────────────────────────────────────────────────────── */}
        {tab === 'usuarios' && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <p className="text-sm text-gray-600">{users.length} usuário{users.length !== 1 ? 's' : ''}</p>
              <button
                onClick={openInvite}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 text-white text-sm font-medium rounded-xl hover:bg-blue-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                Convidar usuário
              </button>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Usuário</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Perfil</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Unidade</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map(u => (
                  <tr key={u.id} className={`hover:bg-gray-50 transition-colors ${!u.ativo ? 'opacity-50' : ''}`}>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-purple-600">{u.full_name[0].toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{u.full_name}</p>
                          <p className="text-xs text-gray-400">{u.email ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${PERFIL_BADGE[u.perfil]}`}>
                        {PERFIL_LABELS[u.perfil]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-sm">{u.unit?.nome ?? <span className="text-gray-400">—</span>}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleUserAtivo(u)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${u.ativo ? 'bg-green-500' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${u.ativo ? 'translate-x-4' : 'translate-x-1'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEditUser(u)}
                        className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Editar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── UNIDADES ──────────────────────────────────────────────────────── */}
        {tab === 'unidades' && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <p className="text-sm text-gray-600">{units.length} unidade{units.length !== 1 ? 's' : ''}</p>
              <button
                onClick={openCreateUnit}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 text-white text-sm font-medium rounded-xl hover:bg-blue-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Nova unidade
              </button>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Unidade</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cidade / Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Telefone</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Usuários</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {units.map(u => {
                  const unitUsers = users.filter(usr => usr.unit_id === u.id)
                  return (
                    <tr key={u.id} className={`hover:bg-gray-50 transition-colors ${!u.ativo ? 'opacity-50' : ''}`}>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
                            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                          </div>
                          <span className="font-medium text-gray-900">{u.nome}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {u.cidade && u.estado ? `${u.cidade} / ${u.estado}` : u.cidade ?? u.estado ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{u.telefone ?? <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {unitUsers.slice(0, 4).map(usr => (
                            <div key={usr.id} className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center" title={usr.full_name}>
                              <span className="text-[9px] font-bold text-purple-600">{usr.full_name[0].toUpperCase()}</span>
                            </div>
                          ))}
                          {unitUsers.length > 4 && (
                            <span className="text-xs text-gray-400">+{unitUsers.length - 4}</span>
                          )}
                          {unitUsers.length === 0 && <span className="text-xs text-gray-400">Sem usuários</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleUnitAtivo(u)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${u.ativo ? 'bg-green-500' : 'bg-gray-300'}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${u.ativo ? 'translate-x-4' : 'translate-x-1'}`} />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openEditUnit(u)}
                          className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modal usuário ───────────────────────────────────────────────────── */}
      {userModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">
                {userModal === 'invite' ? 'Convidar usuário' : 'Editar usuário'}
              </h2>
              <button onClick={() => setUserModal(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 space-y-3">
              <UField label="Nome completo *" value={userForm.full_name} onChange={v => setUserForm(f => ({ ...f, full_name: v }))} />
              {userModal === 'invite' && (
                <UField label="E-mail *" value={userForm.email} onChange={v => setUserForm(f => ({ ...f, email: v }))} type="email" />
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Perfil *</label>
                <select
                  value={userForm.perfil}
                  onChange={e => setUserForm(f => ({ ...f, perfil: e.target.value as UserPerfil }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {PERFIL_OPTIONS.map(p => (
                    <option key={p} value={p}>{PERFIL_LABELS[p]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Unidade</label>
                <select
                  value={userForm.unit_id}
                  onChange={e => setUserForm(f => ({ ...f, unit_id: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Sem unidade</option>
                  {units.filter(u => u.ativo).map(u => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
              </div>
              {userModal === 'invite' && (
                <p className="text-xs text-gray-500 bg-blue-50 rounded-xl px-3 py-2">
                  O usuário receberá um e-mail de convite para definir sua senha.
                </p>
              )}
              {formError && <p className="text-xs text-red-500">{formError}</p>}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setUserModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleSaveUser}
                disabled={saving}
                className="px-4 py-2 text-sm bg-blue-500 text-white font-medium rounded-xl hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Salvando...' : userModal === 'invite' ? 'Enviar convite' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal unidade ───────────────────────────────────────────────────── */}
      {unitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">
                {unitModal === 'create' ? 'Nova unidade' : 'Editar unidade'}
              </h2>
              <button onClick={() => setUnitModal(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 space-y-3">
              <UField label="Nome da unidade *" value={unitForm.nome} onChange={v => setUnitForm(f => ({ ...f, nome: v }))} />
              <div className="grid grid-cols-2 gap-3">
                <UField label="Cidade" value={unitForm.cidade} onChange={v => setUnitForm(f => ({ ...f, cidade: v }))} />
                <UField label="Estado" value={unitForm.estado} onChange={v => setUnitForm(f => ({ ...f, estado: v }))} placeholder="SP" />
              </div>
              <UField label="Telefone" value={unitForm.telefone} onChange={v => setUnitForm(f => ({ ...f, telefone: v }))} />
              {formError && <p className="text-xs text-red-500">{formError}</p>}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setUnitModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleSaveUnit}
                disabled={saving}
                className="px-4 py-2 text-sm bg-blue-500 text-white font-medium rounded-xl hover:bg-blue-600 disabled:opacity-50 transition-colors"
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

function UField({ label, value, onChange, type = 'text', placeholder }: {
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
