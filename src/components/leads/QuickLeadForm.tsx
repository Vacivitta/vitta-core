'use client'

import { useState } from 'react'
import type { FunnelStage, FunnelWithStages, Profile, Lead } from '@/types/database'
import { ORIGEM_OPTIONS } from '@/types/database'
import { createLead } from '@/lib/leads'

interface Props {
  defaultStage: FunnelStage
  funnels: FunnelWithStages[]
  profiles: Profile[]
  currentUser: Profile
  onClose: () => void
  onCreated: (lead: Lead, openFull: boolean) => void
}

export default function QuickLeadForm({
  defaultStage, funnels, profiles, currentUser, onClose, onCreated,
}: Props) {
  const defaultFunnel = funnels.find(f => f.stages.some(s => s.id === defaultStage.id)) ?? funnels[0]

  const [form, setForm] = useState({
    nome:           '',
    telefone:       '',
    funnel_id:      defaultFunnel?.id ?? '',
    stage_id:       defaultStage.id,
    sobrenome:      '',
    email:          '',
    profissao:      '',
    cidade:         '',
    origem:         '',
    responsavel_id: currentUser.id,
  })
  const [expanded, setExpanded] = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const activeFunnel = funnels.find(f => f.id === form.funnel_id) ?? defaultFunnel

  function handleFunnelChange(funnelId: string) {
    const f = funnels.find(x => x.id === funnelId)
    setForm(prev => ({
      ...prev,
      funnel_id: funnelId,
      stage_id:  f?.stages[0]?.id ?? prev.stage_id,
    }))
  }

  async function handleSave(openFull = false) {
    if (!form.nome.trim()) { setError('Informe o nome do lead.'); return }
    setSaving(true)
    setError('')
    try {
      const lead = await createLead({
        nome:           form.nome.trim(),
        sobrenome:      form.sobrenome.trim()  || null,
        telefone:       form.telefone.trim()   || null,
        email:          form.email.trim()      || null,
        profissao:      form.profissao.trim()  || null,
        cidade:         form.cidade.trim()     || null,
        estado:         null,
        pais:           'Brasil',
        instagram:      null,
        site:           null,
        origem:         form.origem            || null,
        funnel_id:      form.funnel_id,
        stage_id:       form.stage_id,
        responsavel_id: form.responsavel_id    || null,
        unit_id:        currentUser.unit_id,
        client_id:      null,
      })
      onCreated(lead, openFull)
    } catch {
      setError('Erro ao salvar. Tente novamente.')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Novo Lead</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1.5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {/* Nome — obrigatório */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
            <input
              autoFocus
              type="text"
              value={form.nome}
              onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); setError('') }}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSave()}
              placeholder="Nome do lead..."
              className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                error ? 'border-red-300 ring-1 ring-red-300' : 'border-gray-200'
              }`}
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>

          {/* Telefone + Etapa */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Telefone</label>
              <input
                type="tel"
                value={form.telefone}
                onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))}
                placeholder="(00) 00000-0000"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Etapa</label>
              <select
                value={form.stage_id}
                onChange={e => setForm(f => ({ ...f, stage_id: e.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {activeFunnel?.stages.map(s => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Funil — só se houver mais de um */}
          {funnels.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Funil</label>
              <select
                value={form.funnel_id}
                onChange={e => handleFunnelChange(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {funnels.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </div>
          )}

          {/* Expandir campos opcionais */}
          {!expanded ? (
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Mais campos
            </button>
          ) : (
            <div className="space-y-3 pt-2 border-t border-gray-100">
              <div className="grid grid-cols-2 gap-3">
                <QField label="Sobrenome"  value={form.sobrenome}  onChange={v => setForm(f => ({ ...f, sobrenome: v }))} />
                <QField label="E-mail"     value={form.email}      onChange={v => setForm(f => ({ ...f, email: v }))}     type="email" />
                <QField label="Profissão"  value={form.profissao}  onChange={v => setForm(f => ({ ...f, profissao: v }))} />
                <QField label="Cidade"     value={form.cidade}     onChange={v => setForm(f => ({ ...f, cidade: v }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Origem</label>
                  <select
                    value={form.origem}
                    onChange={e => setForm(f => ({ ...f, origem: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Selecionar...</option>
                    {ORIGEM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Responsável</label>
                  <select
                    value={form.responsavel_id}
                    onChange={e => setForm(f => ({ ...f, responsavel_id: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => handleSave(false)}
              disabled={saving || !form.nome.trim()}
              className="px-4 py-2 text-sm border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving || !form.nome.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              Salvar e abrir
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function QField({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}
