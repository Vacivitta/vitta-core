'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TICKET_PRIORIDADE_LABELS, type Ticket, type TicketPrioridade } from '@/types/database'

export interface FunilDeTicket { id: string; nome: string; etapas: { id: string; nome: string; ordem: number }[] }

interface Props {
  unitId:     string
  funis:      FunilDeTicket[]
  pessoas:    { id: string; nome: string }[]
  empresas?:  { id: string; nome: string }[]
  /** Vindo da conversa: liga o ticket a ela e ao lead dela */
  inicial?:   { titulo?: string; conversa_id?: string | null; lead_id?: string | null; empresa_id?: string | null }
  usuarioId:  string
  onFechar:   () => void
  onCriado:   (ticket: Ticket) => void
}

const COR = { tinta: '#25402C', fraco: '#9AA79C', medio: '#71856F', borda: '#EBE7DA', verde: '#3E9849', erro: '#DC2626' }
const rotulo: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, color: COR.medio, margin: '10px 0 4px' }
const campo: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', fontSize: 13, border: `1px solid ${COR.borda}`, borderRadius: 8, color: COR.tinta, background: '#fff' }

export default function NovoTicketModal({ unitId, funis, pessoas, empresas = [], inicial, usuarioId, onFechar, onCriado }: Props) {
  const supabase = createClient()
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '')
  const [descricao, setDescricao] = useState('')
  const [funilId, setFunilId] = useState(funis[0]?.id ?? '')
  const [prioridade, setPrioridade] = useState<TicketPrioridade>('media')
  const [responsavelId, setResponsavelId] = useState(usuarioId)
  const [empresaId, setEmpresaId] = useState(inicial?.empresa_id ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const funil = funis.find(f => f.id === funilId)
  const primeiraEtapa = funil ? [...funil.etapas].sort((a, b) => a.ordem - b.ordem)[0] : undefined

  async function criar() {
    if (!titulo.trim() || !funilId) return
    setSalvando(true)
    setErro(null)
    const { data, error } = await supabase.from('tickets').insert({
      unit_id:        unitId,
      titulo:         titulo.trim(),
      descricao:      descricao.trim() || null,
      funnel_id:      funilId,
      stage_id:       primeiraEtapa?.id ?? null,
      prioridade,
      responsavel_id: responsavelId || null,
      empresa_id:     empresaId || null,
      lead_id:        inicial?.lead_id ?? null,
      conversa_id:    inicial?.conversa_id ?? null,
    }).select('*').single()
    setSalvando(false)
    if (error || !data) { setErro(error?.message ?? 'Não foi possível abrir o ticket'); return }
    onCriado(data as Ticket)
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Novo ticket"
      style={{ position: 'fixed', inset: 0, background: 'rgba(37,64,44,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onFechar() }}>
      <div style={{ width: 460, maxWidth: '100%', background: '#fff', borderRadius: 14, padding: '18px 20px', boxShadow: '0 20px 50px -20px rgba(37,64,44,0.4)' }}>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: COR.tinta }}>Novo ticket</p>
        {funis.length === 0 ? (
          <p style={{ fontSize: 12.5, color: COR.fraco, lineHeight: 1.5 }}>
            Esta unidade ainda não tem funil de ticket. Um gestor cria em Configurações › Funis, escolhendo &quot;Funil de ticket&quot;.
          </p>
        ) : (
          <>
            <label style={rotulo} htmlFor="tk-titulo">Título</label>
            <input id="tk-titulo" style={campo} value={titulo} maxLength={200} autoFocus onChange={e => setTitulo(e.target.value)} />
            <label style={rotulo} htmlFor="tk-desc">Descrição</label>
            <textarea id="tk-desc" style={{ ...campo, minHeight: 70, resize: 'vertical' }} value={descricao} onChange={e => setDescricao(e.target.value)} />
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={rotulo} htmlFor="tk-funil">Funil</label>
                <select id="tk-funil" style={campo} value={funilId} onChange={e => setFunilId(e.target.value)}>
                  {funis.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={rotulo} htmlFor="tk-prio">Prioridade</label>
                <select id="tk-prio" style={campo} value={prioridade} onChange={e => setPrioridade(e.target.value as TicketPrioridade)}>
                  {(Object.keys(TICKET_PRIORIDADE_LABELS) as TicketPrioridade[]).map(p => <option key={p} value={p}>{TICKET_PRIORIDADE_LABELS[p]}</option>)}
                </select>
              </div>
            </div>
            <label style={rotulo} htmlFor="tk-resp">Responsável</label>
            <select id="tk-resp" style={campo} value={responsavelId} onChange={e => setResponsavelId(e.target.value)}>
              <option value="">Sem responsável</option>
              {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            {empresas.length > 0 && (
              <>
                <label style={rotulo} htmlFor="tk-emp">Empresa</label>
                <select id="tk-emp" style={campo} value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
                  <option value="">Sem empresa</option>
                  {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </>
            )}
            {erro && <p role="alert" style={{ fontSize: 12, color: COR.erro, margin: '10px 0 0' }}>{erro}</p>}
          </>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onFechar} style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 600, border: `1px solid ${COR.borda}`, borderRadius: 8, background: '#fff', color: COR.medio, cursor: 'pointer' }}>
            Cancelar
          </button>
          {funis.length > 0 && (
            <button onClick={() => void criar()} disabled={salvando || !titulo.trim()}
              style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, border: 'none', borderRadius: 8, background: COR.verde, color: '#fff', cursor: 'pointer', opacity: salvando || !titulo.trim() ? 0.6 : 1 }}>
              {salvando ? 'Abrindo…' : 'Abrir ticket'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
