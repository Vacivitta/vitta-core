'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import NovoTicketModal, { type FunilDeTicket } from '@/components/tickets/NovoTicketModal'
import { colunasDoKanban, ordenarTickets } from '@/lib/tickets'
import { TICKET_PRIORIDADE_LABELS, type Ticket, type TicketPrioridade } from '@/types/database'

export type TicketDaLista = Ticket & { empresa: { nome: string } | null; lead: { nome: string; sobrenome: string | null } | null }

interface Props {
  unitId:        string
  usuarioId:     string
  tickets:       TicketDaLista[]
  funis:         FunilDeTicket[]
  pessoas:       { id: string; nome: string }[]
  empresas:      { id: string; nome: string }[]
  ticketInicial: string | null
}

const COR = { tinta: '#25402C', fraco: '#9AA79C', medio: '#71856F', borda: '#EBE7DA', verde: '#3E9849', erro: '#DC2626' }
const CORES_PRIORIDADE: Record<TicketPrioridade, { cor: string; fundo: string }> = {
  urgente: { cor: '#991B1B', fundo: '#FEE2E2' },
  alta:    { cor: '#9A3412', fundo: '#FFEDD5' },
  media:   { cor: '#1E40AF', fundo: '#DBEAFE' },
  baixa:   { cor: '#4B5563', fundo: '#F3F4F6' },
}
const botao: React.CSSProperties = { padding: '7px 14px', fontSize: 12.5, fontWeight: 700, border: 'none', borderRadius: 8, background: COR.verde, color: '#fff', cursor: 'pointer' }
const botaoLeve: React.CSSProperties = { padding: '6px 11px', fontSize: 12, fontWeight: 600, border: `1px solid ${COR.borda}`, borderRadius: 8, background: '#fff', color: COR.medio, cursor: 'pointer' }
const campo: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12.5, border: `1px solid ${COR.borda}`, borderRadius: 7, color: COR.tinta, background: '#fff' }

export default function TicketsClient({ unitId, usuarioId, tickets: iniciais, funis, pessoas, empresas, ticketInicial }: Props) {
  const supabase = createClient()
  const [tickets, setTickets] = useState(iniciais)
  const [funilId, setFunilId] = useState(() => iniciais.find(t => t.id === ticketInicial)?.funnel_id ?? funis[0]?.id ?? '')
  const [visao, setVisao] = useState<'kanban' | 'lista'>('kanban')
  const [soMeus, setSoMeus] = useState(false)
  const [mostrarResolvidos, setMostrarResolvidos] = useState(false)
  const [abertoId, setAbertoId] = useState<string | null>(ticketInicial)
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const nomeDe = useMemo(() => new Map(pessoas.map(p => [p.id, p.nome])), [pessoas])
  const funil = funis.find(f => f.id === funilId)
  const visiveis = tickets.filter(t => t.funnel_id === funilId
    && (mostrarResolvidos || t.status === 'aberto')
    && (!soMeus || t.responsavel_id === usuarioId))
  const aberto = tickets.find(t => t.id === abertoId) ?? null

  async function alterar(id: string, mudancas: Partial<Ticket>) {
    setErro(null)
    const { data, error } = await supabase.from('tickets').update(mudancas).eq('id', id)
      .select('*, empresa:empresas(nome), lead:leads(nome, sobrenome)').single()
    if (error || !data) { setErro(`Não foi possível salvar: ${error?.message ?? 'sem permissão'}`); return }
    setTickets(prev => prev.map(t => t.id === id ? data as TicketDaLista : t))
  }

  return (
    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: COR.tinta, margin: 0, flex: 1 }}>Tickets</h1>
        {funis.length > 1 && (
          <select value={funilId} onChange={e => setFunilId(e.target.value)} aria-label="Funil de ticket" style={{ ...campo, width: 'auto' }}>
            {funis.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        )}
        <div role="group" aria-label="Visão" style={{ display: 'flex', border: `1px solid ${COR.borda}`, borderRadius: 8, overflow: 'hidden' }}>
          {(['kanban', 'lista'] as const).map(v => (
            <button key={v} onClick={() => setVisao(v)} aria-pressed={visao === v}
              style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: visao === v ? COR.verde : '#fff', color: visao === v ? '#fff' : COR.medio }}>
              {v === 'kanban' ? 'Kanban' : 'Lista'}
            </button>
          ))}
        </div>
        <label style={{ fontSize: 12.5, color: COR.medio, display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={soMeus} onChange={e => setSoMeus(e.target.checked)} /> Só os meus
        </label>
        <label style={{ fontSize: 12.5, color: COR.medio, display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={mostrarResolvidos} onChange={e => setMostrarResolvidos(e.target.checked)} /> Resolvidos (30 dias)
        </label>
        <button style={botao} onClick={() => setCriando(true)}>+ Novo ticket</button>
      </div>

      {erro && <div role="alert" style={{ padding: '9px 13px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 9, fontSize: 12.5, color: COR.erro }}>{erro}</div>}

      {funis.length === 0 ? (
        <p style={{ fontSize: 13, color: COR.fraco }}>Crie um funil de ticket em Configurações › Funis (tipo &quot;Funil de ticket&quot;) para começar.</p>
      ) : visao === 'kanban' && funil ? (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', alignItems: 'flex-start', paddingBottom: 8 }}>
          {colunasDoKanban(funil.etapas, visiveis).map(col => (
            <div key={col.id ?? 'sem-etapa'} style={{ width: 270, flexShrink: 0, background: '#F6F4EC', borderRadius: 12, padding: 10 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12.5, fontWeight: 800, color: COR.tinta }}>
                {col.nome} <span style={{ color: COR.fraco, fontWeight: 600 }}>{col.tickets.length}</span>
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {col.tickets.map(t => <Cartao key={t.id} ticket={t} responsavel={t.responsavel_id ? nomeDe.get(t.responsavel_id) ?? null : null} onAbrir={() => setAbertoId(t.id)} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background: '#fff', border: `1px solid ${COR.borda}`, borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: COR.medio }}>
                {['#', 'Título', 'Prioridade', 'Etapa', 'Responsável', 'Empresa', 'Aberto em'].map(h => <th key={h} style={{ padding: '9px 12px', borderBottom: `1px solid ${COR.borda}` }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {ordenarTickets(visiveis).map(t => (
                <tr key={t.id} onClick={() => setAbertoId(t.id)} style={{ cursor: 'pointer', color: COR.tinta }}>
                  <td style={{ padding: '8px 12px', borderBottom: `1px solid ${COR.borda}` }}>{t.numero}</td>
                  <td style={{ padding: '8px 12px', borderBottom: `1px solid ${COR.borda}`, fontWeight: 700 }}>{t.titulo}{t.status === 'resolvido' && ' ✓'}</td>
                  <td style={{ padding: '8px 12px', borderBottom: `1px solid ${COR.borda}` }}><Prioridade p={t.prioridade} /></td>
                  <td style={{ padding: '8px 12px', borderBottom: `1px solid ${COR.borda}` }}>{funil?.etapas.find(e => e.id === t.stage_id)?.nome ?? '—'}</td>
                  <td style={{ padding: '8px 12px', borderBottom: `1px solid ${COR.borda}` }}>{t.responsavel_id ? nomeDe.get(t.responsavel_id) ?? '—' : '—'}</td>
                  <td style={{ padding: '8px 12px', borderBottom: `1px solid ${COR.borda}` }}>{t.empresa?.nome ?? '—'}</td>
                  <td style={{ padding: '8px 12px', borderBottom: `1px solid ${COR.borda}` }}>{new Date(t.criado_em).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
              {visiveis.length === 0 && <tr><td colSpan={7} style={{ padding: 16, color: COR.fraco }}>Nenhum ticket.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {aberto && (
        <PainelDoTicket ticket={aberto} funil={funis.find(f => f.id === aberto.funnel_id)} pessoas={pessoas} empresas={empresas}
          onFechar={() => setAbertoId(null)} onAlterar={m => void alterar(aberto.id, m)} />
      )}

      {criando && (
        <NovoTicketModal unitId={unitId} funis={funis} pessoas={pessoas} empresas={empresas} usuarioId={usuarioId}
          onFechar={() => setCriando(false)}
          onCriado={t => {
            setCriando(false)
            setTickets(prev => [{ ...t, empresa: empresas.find(e => e.id === t.empresa_id) ? { nome: empresas.find(e => e.id === t.empresa_id)!.nome } : null, lead: null }, ...prev])
            setFunilId(t.funnel_id)
            setAbertoId(t.id)
          }} />
      )}
    </div>
  )
}

function Prioridade({ p }: { p: TicketPrioridade }) {
  const c = CORES_PRIORIDADE[p]
  return <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, color: c.cor, background: c.fundo }}>{TICKET_PRIORIDADE_LABELS[p]}</span>
}

function Cartao({ ticket, responsavel, onAbrir }: { ticket: TicketDaLista; responsavel: string | null; onAbrir: () => void }) {
  return (
    <button onClick={onAbrir}
      style={{ textAlign: 'left', background: '#fff', border: `1px solid ${COR.borda}`, borderRadius: 10, padding: '9px 10px', cursor: 'pointer', opacity: ticket.status === 'resolvido' ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: COR.fraco }}>#{ticket.numero}</span>
        <Prioridade p={ticket.prioridade} />
        {ticket.status === 'resolvido' && <span style={{ fontSize: 10.5, color: '#166534', fontWeight: 700 }}>Resolvido</span>}
      </div>
      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: COR.tinta }}>{ticket.titulo}</p>
      <p style={{ margin: '3px 0 0', fontSize: 11, color: COR.fraco }}>
        {[ticket.empresa?.nome, responsavel ? `com ${responsavel}` : 'sem responsável'].filter(Boolean).join(' · ')}
      </p>
    </button>
  )
}

function PainelDoTicket({ ticket, funil, pessoas, empresas, onFechar, onAlterar }: {
  ticket: TicketDaLista; funil: FunilDeTicket | undefined; pessoas: { id: string; nome: string }[]; empresas: { id: string; nome: string }[]
  onFechar: () => void; onAlterar: (m: Partial<Ticket>) => void
}) {
  const [descricao, setDescricao] = useState(ticket.descricao ?? '')
  const rotulo: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, color: COR.medio, margin: '12px 0 4px' }
  return (
    <div role="dialog" aria-label={`Ticket #${ticket.numero}`}
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, maxWidth: '100%', background: '#fff', borderLeft: `1px solid ${COR.borda}`, boxShadow: '-12px 0 30px -20px rgba(37,64,44,0.35)', zIndex: 50, padding: '18px 20px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: COR.fraco }}>Ticket #{ticket.numero}</span>
        <Prioridade p={ticket.prioridade} />
        <span style={{ flex: 1 }} />
        <button onClick={onFechar} aria-label="Fechar" style={{ ...botaoLeve, padding: '3px 9px' }}>×</button>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 16, fontWeight: 800, color: COR.tinta }}>{ticket.titulo}</p>
      <p style={{ margin: '4px 0 0', fontSize: 11.5, color: COR.fraco }}>
        Aberto em {new Date(ticket.criado_em).toLocaleString('pt-BR')}
        {ticket.resolvido_em && ` · resolvido em ${new Date(ticket.resolvido_em).toLocaleString('pt-BR')}`}
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {ticket.status === 'aberto'
          ? <button style={botao} onClick={() => onAlterar({ status: 'resolvido' })}>Marcar como resolvido</button>
          : <button style={botaoLeve} onClick={() => onAlterar({ status: 'aberto' })}>Reabrir</button>}
        {ticket.conversa_id && <Link href={`/atendimento?conversa=${ticket.conversa_id}`} style={{ ...botaoLeve, textDecoration: 'none' }}>Ver conversa</Link>}
        {ticket.lead_id && <Link href={`/funil?lead=${ticket.lead_id}`} style={{ ...botaoLeve, textDecoration: 'none' }}>Ver lead</Link>}
      </div>

      <label style={rotulo} htmlFor="tk-etapa">Etapa</label>
      <select id="tk-etapa" style={campo} value={ticket.stage_id ?? ''} onChange={e => onAlterar({ stage_id: e.target.value || null })}>
        <option value="">Sem etapa</option>
        {[...(funil?.etapas ?? [])].sort((a, b) => a.ordem - b.ordem).map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
      </select>
      <label style={rotulo} htmlFor="tk-resp2">Responsável</label>
      <select id="tk-resp2" style={campo} value={ticket.responsavel_id ?? ''} onChange={e => onAlterar({ responsavel_id: e.target.value || null })}>
        <option value="">Sem responsável</option>
        {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
      </select>
      <label style={rotulo} htmlFor="tk-prio2">Prioridade</label>
      <select id="tk-prio2" style={campo} value={ticket.prioridade} onChange={e => onAlterar({ prioridade: e.target.value as TicketPrioridade })}>
        {(Object.keys(TICKET_PRIORIDADE_LABELS) as TicketPrioridade[]).map(p => <option key={p} value={p}>{TICKET_PRIORIDADE_LABELS[p]}</option>)}
      </select>
      {empresas.length > 0 && (
        <>
          <label style={rotulo} htmlFor="tk-emp2">Empresa</label>
          <select id="tk-emp2" style={campo} value={ticket.empresa_id ?? ''} onChange={e => onAlterar({ empresa_id: e.target.value || null })}>
            <option value="">Sem empresa</option>
            {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </>
      )}
      <label style={rotulo} htmlFor="tk-desc2">Descrição</label>
      <textarea id="tk-desc2" style={{ ...campo, minHeight: 110, resize: 'vertical' }} value={descricao}
        onChange={e => setDescricao(e.target.value)}
        onBlur={() => { if (descricao !== (ticket.descricao ?? '')) onAlterar({ descricao: descricao.trim() || null }) }} />
      {ticket.lead && <p style={{ fontSize: 12, color: COR.medio, marginTop: 12 }}>Lead: {[ticket.lead.nome, ticket.lead.sobrenome].filter(Boolean).join(' ')}</p>}
    </div>
  )
}
