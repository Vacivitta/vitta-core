'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { STATUS_LEAD_LABELS, type LeadKanban, type FunnelWithStages } from '@/types/database'
import { desarquivar, getLeadsArquivados } from '@/lib/leads'
import { primeiraLetra } from '@/lib/texto'

interface Props {
  funnels: FunnelWithStages[]
  selectedFunnelId: string
  /** Unidade ativa: o admin global enxerga todas pela RLS */
  unitId: string | null
  /** Mesma regra do botão Arquivar da ficha (atendente não arquiva nem desarquiva) */
  podeDesarquivar: boolean
  onOpenLead: (lead: LeadKanban) => void
  /** Um lead foi desarquivado (o quadro e o contador precisam recarregar) */
  onChanged: () => void
  onClose: () => void
}

/** Painel "Arquivados" do funil: leads tirados do quadro (migração 132), com motivo e ação de desarquivar. */
export default function ArquivadosPanel({
  funnels, selectedFunnelId, unitId, podeDesarquivar, onOpenLead, onChanged, onClose,
}: Props) {
  const [leads, setLeads]               = useState<LeadKanban[]>([])
  const [loading, setLoading]           = useState(true)
  const [erro, setErro]                 = useState('')
  const [funnelFilter, setFunnelFilter] = useState(selectedFunnelId)
  const [desarquivando, setDesarquivando] = useState<string | null>(null)

  useEffect(() => {
    getLeadsArquivados(funnelFilter || undefined, unitId)
      .then(setLeads)
      .catch(() => setErro('Não foi possível carregar os arquivados.'))
      .finally(() => setLoading(false))
  }, [funnelFilter, unitId])

  async function handleDesarquivar(lead: LeadKanban) {
    if (desarquivando) return
    setDesarquivando(lead.id)
    setErro('')
    try {
      await desarquivar(lead.id)
      setLeads(prev => prev.filter(l => l.id !== lead.id))
      onChanged()
    } catch {
      setErro('Não foi possível desarquivar. Tente novamente.')
    } finally {
      setDesarquivando(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl h-[85dvh] sm:h-auto sm:max-h-[80vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Arquivados</h2>
            <p className="text-xs text-gray-400">
              {loading ? 'Carregando...' : `${leads.length} ${leads.length === 1 ? 'contato' : 'contatos'} fora do funil`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {funnels.length > 1 && (
              <select
                value={funnelFilter}
                onChange={e => { setLoading(true); setFunnelFilter(e.target.value) }}
                className="text-sm border border-[#EBE7DA] rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#3E9849] bg-white"
              >
                <option value="">Todos os funis</option>
                {funnels.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            )}
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1.5 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {erro && <p className="px-5 pt-3 text-xs text-red-500">{erro}</p>}

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
                <div key={lead.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <button
                    onClick={() => onOpenLead(lead)}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left"
                  >
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-gray-500">{primeiraLetra(lead.nome)}</span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900 truncate">
                        {lead.nome}{lead.sobrenome ? ` ${lead.sobrenome}` : ''}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {lead.arquivado_motivo && (
                          <span className="text-[11px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-full">
                            {lead.arquivado_motivo}
                          </span>
                        )}
                        {lead.status !== 'aberto' && (
                          <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${lead.status === 'perdido' ? 'text-red-500 bg-red-50' : 'text-white bg-[#25402C]'}`}>
                            {STATUS_LEAD_LABELS[lead.status]}
                          </span>
                        )}
                        {lead.is_converted && (
                          <span className="text-[11px] text-[#35853F] bg-[#E8F4E6] px-1.5 py-0.5 rounded-full">
                            Cliente
                          </span>
                        )}
                        {lead.stage_nome && <span className="text-[11px] text-gray-400">{lead.stage_nome}</span>}
                      </div>
                    </div>

                    {/* Meta */}
                    <div className="text-right shrink-0">
                      {lead.responsavel_nome && <p className="text-xs text-gray-400">{lead.responsavel_nome}</p>}
                      {lead.arquivado_em && (
                        <p className="text-xs text-gray-300">
                          {format(new Date(lead.arquivado_em), 'd MMM yy', { locale: ptBR })}
                        </p>
                      )}
                    </div>
                  </button>

                  {podeDesarquivar && (
                    <button
                      onClick={() => void handleDesarquivar(lead)}
                      disabled={desarquivando !== null}
                      className="shrink-0 text-xs font-semibold text-[#35853F] border border-[#C8D9C4] rounded-lg px-2.5 py-1 hover:bg-[#E8F4E6] transition-colors disabled:opacity-50"
                      title="Volta para o funil, na etapa onde estava"
                    >
                      {desarquivando === lead.id ? 'Salvando...' : 'Desarquivar'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
