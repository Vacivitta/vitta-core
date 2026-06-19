'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { LeadKanban, FunnelWithStages } from '@/types/database'
import { getArchivedLeads } from '@/lib/leads'

interface Props {
  funnels: FunnelWithStages[]
  selectedFunnelId: string
  onOpenLead: (lead: LeadKanban) => void
  onClose: () => void
}

export default function ArchivedLeadsPanel({ funnels, selectedFunnelId, onOpenLead, onClose }: Props) {
  const [leads, setLeads]         = useState<LeadKanban[]>([])
  const [loading, setLoading]     = useState(true)
  const [funnelFilter, setFunnelFilter] = useState(selectedFunnelId)

  useEffect(() => {
    setLoading(true)
    getArchivedLeads(funnelFilter || undefined)
      .then(setLeads)
      .finally(() => setLoading(false))
  }, [funnelFilter])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl h-[85dvh] sm:h-auto sm:max-h-[80vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Contatos Arquivados</h2>
            <p className="text-xs text-gray-400">
              {loading ? 'Carregando...' : `${leads.length} ${leads.length === 1 ? 'contato' : 'contatos'}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {funnels.length > 1 && (
              <select
                value={funnelFilter}
                onChange={e => setFunnelFilter(e.target.value)}
                className="text-sm border border-gray-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Todos os funis</option>
                {funnels.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1.5 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400">Carregando...</div>
          ) : leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              <p className="text-sm">Nenhum contato arquivado</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {leads.map(lead => (
                <button
                  key={lead.id}
                  onClick={() => onOpenLead(lead)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
                >
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-gray-500">
                      {lead.nome[0]?.toUpperCase()}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900">
                      {lead.nome}{lead.sobrenome ? ` ${lead.sobrenome}` : ''}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {lead.stage_nome && (
                        <span
                          className="text-[11px] font-medium px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: `${lead.stage_cor}22`, color: lead.stage_cor ?? '#64748b' }}
                        >
                          {lead.stage_nome}
                        </span>
                      )}
                      {lead.motivo_perda && (
                        <span className="text-[11px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">
                          {lead.motivo_perda}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Meta */}
                  <div className="text-right shrink-0">
                    {lead.responsavel_nome && (
                      <p className="text-xs text-gray-400">{lead.responsavel_nome}</p>
                    )}
                    <p className="text-xs text-gray-300">
                      {format(new Date(lead.updated_at), "d MMM yy", { locale: ptBR })}
                    </p>
                  </div>

                  <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
