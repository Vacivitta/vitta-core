'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Unit, UserPerfil } from '@/types/database'
import { PERFIL_LABELS } from '@/types/database'

interface UserProfile {
  id:         string
  full_name:  string
  apelido:    string | null
  email:      string | null
  perfil:     UserPerfil
  unit_id:    string | null
  unit_ids:   string[]
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
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null)
  const [deleting,     setDeleting]    = useState(false)
  const [deleteError,  setDeleteError]  = useState('')

  // ── Formulário de usuário ──────────────────────────────────────────────────
  const [inviteMode,      setInviteMode]      = useState<'email' | 'password'>('email')
  const [createdCreds,    setCreatedCreds]    = useState<{ email: string; password: string } | null>(null)
  const [userForm, setUserForm] = useState({
    full_name: '', apelido: '', email: '', password: '', perfil: 'atendente' as UserPerfil, unit_ids: [] as string[],
  })

  // ── Formulário de unidade ──────────────────────────────────────────────────
  const [unitForm, setUnitForm] = useState({
    nome: '', cidade: '', estado: '', telefone: '',
  })

  // ── Usuários ───────────────────────────────────────────────────────────────
  function openInvite() {
    setUserForm({ full_name: '', apelido: '', email: '', password: '', perfil: 'atendente', unit_ids: [] })
    setSelUser(null)
    setFormError('')
    setInviteMode('email')
    setCreatedCreds(null)
    setUserModal('invite')
  }

  function openEditUser(u: UserProfile) {
    setUserForm({ full_name: u.full_name, apelido: u.apelido ?? '', email: u.email ?? '', password: '', perfil: u.perfil, unit_ids: u.unit_ids ?? (u.unit_id ? [u.unit_id] : []) })
    setSelUser(u)
    setFormError('')
    setUserModal('edit')
  }

  async function handleSaveUser() {
    if (!userForm.full_name.trim()) { setFormError('Nome é obrigatório.'); return }
    setSaving(true); setFormError('')

    try {
      if (userModal === 'invite') {
        if (inviteMode === 'email' && !userForm.email.trim()) {
          setFormError('E-mail é obrigatório.'); setSaving(false); return
        }
        if (inviteMode === 'password' && userForm.password.length < 6) {
          setFormError('Senha deve ter pelo menos 6 caracteres.'); setSaving(false); return
        }

        const body = inviteMode === 'email'
          ? { email: userForm.email.trim(), full_name: userForm.full_name.trim(), apelido: userForm.apelido.trim() || null, perfil: userForm.perfil, unit_ids: userForm.unit_ids }
          : { password: userForm.password, full_name: userForm.full_name.trim(), apelido: userForm.apelido.trim() || null, perfil: userForm.perfil, unit_ids: userForm.unit_ids }

        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await res.json()
        if (!res.ok) { setFormError(json.error ?? 'Erro ao criar usuário.'); setSaving(false); return }

        // Modo senha: exibe credenciais geradas antes de fechar
        if (inviteMode === 'password' && json.generated_email) {
          setCreatedCreds({ email: json.generated_email, password: userForm.password })
        } else {
          setUserModal(null)
        }

        // Recarrega lista via API para ter unit_ids atualizado
        const listRes = await fetch('/api/admin/users')
        if (listRes.ok) setUsers(await listRes.json())
      } else if (selUser) {
        const res = await fetch(`/api/admin/users/${selUser.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: userForm.full_name.trim(),
            apelido:   userForm.apelido.trim() || null,
            perfil:    userForm.perfil,
            unit_ids:  userForm.unit_ids,
          }),
        })
        if (!res.ok) { const j = await res.json(); setFormError(j.error ?? 'Erro ao salvar.'); setSaving(false); return }
        const primaryUnit = units.find(u => u.id === userForm.unit_ids[0])
        setUsers(prev => prev.map(u => u.id === selUser.id
          ? { ...u, full_name: userForm.full_name.trim(), apelido: userForm.apelido.trim() || null, perfil: userForm.perfil, unit_id: userForm.unit_ids[0] ?? null, unit_ids: userForm.unit_ids, unit: primaryUnit ? { id: primaryUnit.id, nome: primaryUnit.nome } : null }
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

  async function handleDeleteUser() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    const res = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json()
      setDeleteError(j.error ?? 'Erro ao excluir.')
      setDeleting(false)
      return
    }
    setUsers(prev => prev.filter(u => u.id !== deleteTarget.id))
    setDeleteTarget(null)
    setDeleting(false)
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'Erro desconhecido'
      setFormError(`Erro ao salvar: ${msg}`)
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
    atendente:        'bg-[#E8F4E6] text-[#35853F]',
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
                  ? 'border-[#3E9849] text-[#3E9849]'
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
                className="flex items-center gap-2 px-3 py-1.5 bg-[#3E9849] text-white text-sm font-medium rounded-xl hover:bg-[#35853F] transition-colors"
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
                          {u.apelido
                            ? <p className="text-xs font-medium text-[#3E9849]">@{u.apelido}</p>
                            : <p className="text-xs text-gray-400">{u.email ?? '—'}</p>
                          }
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${PERFIL_BADGE[u.perfil]}`}>
                        {PERFIL_LABELS[u.perfil]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-sm">
                      {u.unit_ids?.length > 0
                        ? <div className="flex flex-wrap gap-1">
                            {u.unit_ids.map(uid => {
                              const unit = units.find(un => un.id === uid)
                              return unit ? (
                                <span key={uid} className="inline-flex items-center text-xs bg-indigo-50 text-indigo-700 rounded-full px-2 py-0.5">{unit.nome}</span>
                              ) : null
                            })}
                          </div>
                        : <span className="text-gray-400">—</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleUserAtivo(u)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${u.ativo ? 'bg-green-500' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${u.ativo ? 'translate-x-4' : 'translate-x-1'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditUser(u)}
                          className="p-1.5 text-gray-400 hover:text-[#3E9849] hover:bg-[#E8F4E6] rounded-lg transition-colors"
                          title="Editar"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => { setDeleteTarget(u); setDeleteError('') }}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
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
          </div>
        )}

        {/* ── UNIDADES ──────────────────────────────────────────────────────── */}
        {tab === 'unidades' && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <p className="text-sm text-gray-600">{units.length} unidade{units.length !== 1 ? 's' : ''}</p>
              <button
                onClick={openCreateUnit}
                className="flex items-center gap-2 px-3 py-1.5 bg-[#3E9849] text-white text-sm font-medium rounded-xl hover:bg-[#35853F] transition-colors"
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
                          className="p-1.5 text-gray-400 hover:text-[#3E9849] hover:bg-[#E8F4E6] rounded-lg transition-colors"
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

            {/* Tela de credenciais geradas (após criação com senha) */}
            {createdCreds ? (
              <>
                <div className="px-6 py-5 space-y-4">
                  <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl border border-green-200">
                    <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-sm text-green-800 font-medium">Conta criada com sucesso!</p>
                  </div>
                  <p className="text-xs text-gray-500">Compartilhe as credenciais abaixo com o usuário. Elas não serão exibidas novamente.</p>
                  <div className="space-y-2">
                    <CredField label="Login (e-mail)" value={createdCreds.email} />
                    <CredField label="Senha temporária" value={createdCreds.password} />
                  </div>
                </div>
                <div className="flex justify-end px-6 py-4 border-t border-gray-100">
                  <button
                    onClick={() => { setUserModal(null); setCreatedCreds(null) }}
                    className="px-4 py-2 text-sm bg-[#3E9849] text-white font-medium rounded-xl hover:bg-[#35853F] transition-colors"
                  >
                    Concluir
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="px-6 py-4 space-y-3">
                  {/* Toggle modo de convite */}
                  {userModal === 'invite' && (
                    <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm">
                      <button
                        onClick={() => { setInviteMode('email'); setFormError('') }}
                        className={`flex-1 py-2 font-medium transition-colors ${inviteMode === 'email' ? 'bg-[#3E9849] text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                      >
                        Convidar por e-mail
                      </button>
                      <button
                        onClick={() => { setInviteMode('password'); setFormError('') }}
                        className={`flex-1 py-2 font-medium transition-colors ${inviteMode === 'password' ? 'bg-[#3E9849] text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                      >
                        Criar com senha
                      </button>
                    </div>
                  )}

                  <UField label="Nome completo *" value={userForm.full_name} onChange={v => setUserForm(f => ({ ...f, full_name: v }))} />
                  <UField label="Apelido (nome no atendimento)" value={userForm.apelido} onChange={v => setUserForm(f => ({ ...f, apelido: v }))} placeholder="ex: Ana, Dr. João" />

                  {userModal === 'invite' && inviteMode === 'email' && (
                    <UField label="E-mail *" value={userForm.email} onChange={v => setUserForm(f => ({ ...f, email: v }))} type="email" />
                  )}
                  {userModal === 'invite' && inviteMode === 'password' && (
                    <UField label="Senha temporária *" value={userForm.password} onChange={v => setUserForm(f => ({ ...f, password: v }))} type="password" placeholder="Mínimo 6 caracteres" />
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Perfil *</label>
                    <select
                      value={userForm.perfil}
                      onChange={e => setUserForm(f => ({ ...f, perfil: e.target.value as UserPerfil }))}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E9849] bg-white"
                    >
                      {PERFIL_OPTIONS.map(p => (
                        <option key={p} value={p}>{PERFIL_LABELS[p]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Unidades com visibilidade
                      {userForm.unit_ids.length > 0 && (
                        <span className="ml-1.5 text-[#3E9849]">{userForm.unit_ids.length} selecionada{userForm.unit_ids.length !== 1 ? 's' : ''}</span>
                      )}
                    </label>
                    <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden max-h-40 overflow-y-auto">
                      {units.filter(u => u.ativo).map(u => {
                        const checked = userForm.unit_ids.includes(u.id)
                        return (
                          <label key={u.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors ${checked ? 'bg-[#E8F4E6]' : ''}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setUserForm(f => ({
                                ...f,
                                unit_ids: checked
                                  ? f.unit_ids.filter(id => id !== u.id)
                                  : [...f.unit_ids, u.id],
                              }))}
                              className="rounded border-[#C9C3B2] text-[#3E9849] focus:ring-[#3E9849]"
                            />
                            <span className="text-sm text-gray-700">{u.nome}</span>
                            {userForm.unit_ids[0] === u.id && (
                              <span className="ml-auto text-xs text-[#3E9849] font-medium">principal</span>
                            )}
                          </label>
                        )
                      })}
                      {units.filter(u => u.ativo).length === 0 && (
                        <p className="px-3 py-2 text-sm text-gray-400">Nenhuma unidade cadastrada</p>
                      )}
                    </div>
                  </div>

                  {userModal === 'invite' && inviteMode === 'email' && (
                    <p className="text-xs text-gray-500 bg-[#E8F4E6] rounded-xl px-3 py-2">
                      O usuário receberá um e-mail de convite para definir sua própria senha.
                    </p>
                  )}
                  {userModal === 'invite' && inviteMode === 'password' && (
                    <p className="text-xs text-gray-500 bg-amber-50 rounded-xl px-3 py-2 border border-amber-100">
                      Nenhum e-mail é enviado. Após criar, você verá as credenciais de acesso para repassar pessoalmente.
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
                    className="px-4 py-2 text-sm bg-[#3E9849] text-white font-medium rounded-xl hover:bg-[#35853F] disabled:opacity-50 transition-colors"
                  >
                    {saving ? 'Salvando...' : userModal === 'invite'
                      ? (inviteMode === 'email' ? 'Enviar convite' : 'Criar conta')
                      : 'Salvar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Modal confirmação de exclusão ──────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Excluir usuário</h2>
                  <p className="text-sm text-gray-500">{deleteTarget.full_name}</p>
                </div>
              </div>
              <p className="text-sm text-gray-600">
                Essa ação é <strong>permanente</strong>. O usuário perderá o acesso imediatamente e não poderá ser recuperado.
              </p>
              {deleteError && <p className="mt-2 text-xs text-red-500">{deleteError}</p>}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteUser}
                disabled={deleting}
                className="px-4 py-2 text-sm bg-red-500 text-white font-medium rounded-xl hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Excluindo...' : 'Excluir permanentemente'}
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
                className="px-4 py-2 text-sm bg-[#3E9849] text-white font-medium rounded-xl hover:bg-[#35853F] disabled:opacity-50 transition-colors"
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
        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E9849]"
      />
    </div>
  )
}

function CredField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
        <span className="flex-1 text-sm font-mono text-gray-800 select-all">{value}</span>
        <button onClick={copy} className="text-xs text-[#3E9849] hover:text-[#35853F] font-medium shrink-0">
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}
