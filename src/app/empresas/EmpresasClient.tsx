'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cnpjParaGravar, formatarCnpj } from '@/lib/tickets'
import { PAPEL_NA_EMPRESA_LABELS, type Empresa, type PapelNaEmpresa } from '@/types/database'

export type EmpresaDaLista = Empresa & { contatos: number; totalTickets: number }

interface Props {
  unitId:         string
  usuarioId:      string
  gestor:         boolean
  ticketsLigado:  boolean
  pessoas:        { id: string; nome: string }[]
  empresas:       EmpresaDaLista[]
  empresaInicial: string | null
}

interface Detalhe {
  vinculos: { lead_id: string; papel: PapelNaEmpresa; lead: { nome: string; sobrenome: string | null; telefone: string | null } | null }[]
  tickets:  { id: string; numero: number; titulo: string; status: string }[]
  grupos:   { id: string; wa_contact_name: string | null }[]
}

const COR = { tinta: '#25402C', fraco: '#9AA79C', medio: '#71856F', borda: '#EBE7DA', verde: '#3E9849', erro: '#DC2626' }
const campo: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', fontSize: 13, border: `1px solid ${COR.borda}`, borderRadius: 8, color: COR.tinta, background: '#fff' }
const botao: React.CSSProperties = { padding: '7px 14px', fontSize: 12.5, fontWeight: 700, border: 'none', borderRadius: 8, background: COR.verde, color: '#fff', cursor: 'pointer' }
const botaoLeve: React.CSSProperties = { padding: '5px 10px', fontSize: 12, fontWeight: 600, border: `1px solid ${COR.borda}`, borderRadius: 8, background: '#fff', color: COR.medio, cursor: 'pointer' }
const rotulo: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, color: COR.medio, margin: '10px 0 4px' }

export default function EmpresasClient({ unitId, usuarioId, gestor, ticketsLigado, pessoas, empresas: iniciais, empresaInicial }: Props) {
  const supabase = createClient()
  const [empresas, setEmpresas] = useState(iniciais)
  const [busca, setBusca] = useState('')
  const [selecionadaId, setSelecionadaId] = useState<string | null>(empresaInicial)
  const [nova, setNova] = useState<{ nome: string; cnpj: string } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const filtradas = empresas.filter(e => {
    const q = busca.trim().toLowerCase()
    return !q || e.nome.toLowerCase().includes(q) || (e.cnpj ?? '').includes(q.replace(/\D/g, '') || '§')
  })
  const selecionada = empresas.find(e => e.id === selecionadaId) ?? null

  async function criar() {
    if (!nova?.nome.trim()) return
    const { cnpj, erro: erroCnpj } = cnpjParaGravar(nova.cnpj)
    if (erroCnpj) { setErro(erroCnpj); return }
    setErro(null)
    const { data, error } = await supabase.from('empresas')
      .insert({ unit_id: unitId, nome: nova.nome.trim(), cnpj, criado_por: usuarioId }).select('*').single()
    if (error || !data) {
      setErro(error?.code === '23505' ? 'Já existe uma empresa com esse CNPJ nesta unidade.' : `Não foi possível criar: ${error?.message}`)
      return
    }
    setEmpresas(prev => [...prev, { ...(data as Empresa), contatos: 0, totalTickets: 0 }].sort((a, b) => a.nome.localeCompare(b.nome)))
    setNova(null)
    setSelecionadaId(data.id as string)
  }

  return (
    <div style={{ padding: '24px 28px', display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 340px', minWidth: 300 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: COR.tinta, margin: 0, flex: 1 }}>Empresas</h1>
          <button style={botao} onClick={() => setNova({ nome: '', cnpj: '' })}>+ Nova empresa</button>
        </div>
        {erro && <div role="alert" style={{ padding: '9px 13px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 9, fontSize: 12.5, color: COR.erro, marginBottom: 10 }}>{erro}</div>}
        {nova && (
          <div style={{ background: '#fff', border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <label style={{ ...rotulo, marginTop: 0 }} htmlFor="emp-nome">Nome</label>
            <input id="emp-nome" style={campo} autoFocus value={nova.nome} onChange={e => setNova({ ...nova, nome: e.target.value })} />
            <label style={rotulo} htmlFor="emp-cnpj">CNPJ (opcional)</label>
            <input id="emp-cnpj" style={campo} value={nova.cnpj} placeholder="00.000.000/0000-00" onChange={e => setNova({ ...nova, cnpj: e.target.value })} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button style={botao} disabled={!nova.nome.trim()} onClick={() => void criar()}>Criar</button>
              <button style={botaoLeve} onClick={() => setNova(null)}>Cancelar</button>
            </div>
          </div>
        )}
        <input style={{ ...campo, marginBottom: 10 }} placeholder="Buscar por nome ou CNPJ" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar empresa" />
        <div style={{ background: '#fff', border: `1px solid ${COR.borda}`, borderRadius: 12 }}>
          {filtradas.length === 0 && <p style={{ padding: 14, margin: 0, fontSize: 12.5, color: COR.fraco }}>Nenhuma empresa.</p>}
          {filtradas.map(e => (
            <button key={e.id} onClick={() => setSelecionadaId(e.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: `1px solid ${COR.borda}`, cursor: 'pointer', background: e.id === selecionadaId ? '#F0F7EE' : '#fff' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COR.tinta }}>{e.nome}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: COR.fraco }}>
                {[e.cnpj ? formatarCnpj(e.cnpj) : null, `${e.contatos} contato${e.contatos === 1 ? '' : 's'}`, ticketsLigado ? `${e.totalTickets} ticket${e.totalTickets === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
              </p>
            </button>
          ))}
        </div>
      </div>

      {selecionada && (
        <FichaDaEmpresa key={selecionada.id} empresa={selecionada} unitId={unitId} gestor={gestor} ticketsLigado={ticketsLigado} pessoas={pessoas}
          onAlterada={e => setEmpresas(prev => prev.map(x => x.id === e.id ? { ...x, ...e } : x))}
          onApagada={() => { setEmpresas(prev => prev.filter(x => x.id !== selecionada.id)); setSelecionadaId(null) }} />
      )}
    </div>
  )
}

async function buscarDetalhe(supabase: ReturnType<typeof createClient>, empresaId: string, ticketsLigado: boolean): Promise<Detalhe> {
  const [{ data: vinculos }, { data: tickets }, { data: grupos }] = await Promise.all([
    supabase.from('empresa_vinculos').select('lead_id, papel, lead:leads(nome, sobrenome, telefone)').eq('empresa_id', empresaId),
    ticketsLigado
      ? supabase.from('tickets').select('id, numero, titulo, status').eq('empresa_id', empresaId).order('criado_em', { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
    supabase.from('wa_conversations').select('id, wa_contact_name').eq('empresa_id', empresaId),
  ])
  return { vinculos: (vinculos ?? []) as unknown as Detalhe['vinculos'], tickets: (tickets ?? []) as Detalhe['tickets'], grupos: (grupos ?? []) as Detalhe['grupos'] }
}

function FichaDaEmpresa({ empresa, unitId, gestor, ticketsLigado, pessoas, onAlterada, onApagada }: {
  empresa: EmpresaDaLista; unitId: string; gestor: boolean; ticketsLigado: boolean; pessoas: { id: string; nome: string }[]
  onAlterada: (e: Partial<EmpresaDaLista> & { id: string }) => void; onApagada: () => void
}) {
  const supabase = createClient()
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null)
  const [form, setForm] = useState({ nome: empresa.nome, cnpj: formatarCnpj(empresa.cnpj), responsavel_id: empresa.responsavel_id ?? '', observacao: empresa.observacao ?? '' })
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<{ id: string; nome: string; sobrenome: string | null; telefone: string | null }[]>([])
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => setDetalhe(await buscarDetalhe(supabase, empresa.id, ticketsLigado)),
    [empresa.id, supabase, ticketsLigado])

  useEffect(() => {
    let vivo = true
    void buscarDetalhe(supabase, empresa.id, ticketsLigado).then(d => { if (vivo) setDetalhe(d) })
    return () => { vivo = false }
  }, [empresa.id, supabase, ticketsLigado])


  async function salvar() {
    const { cnpj, erro: erroCnpj } = cnpjParaGravar(form.cnpj)
    if (erroCnpj) { setErro(erroCnpj); return }
    if (!form.nome.trim()) { setErro('A empresa precisa de um nome'); return }
    setErro(null)
    const mudancas = { nome: form.nome.trim(), cnpj, responsavel_id: form.responsavel_id || null, observacao: form.observacao.trim() || null }
    const { error } = await supabase.from('empresas').update(mudancas).eq('id', empresa.id)
    if (error) { setErro(error.code === '23505' ? 'Já existe uma empresa com esse CNPJ nesta unidade.' : `Não foi possível salvar: ${error.message}`); return }
    onAlterada({ id: empresa.id, ...mudancas })
  }

  async function buscarLeads(q: string) {
    setBusca(q)
    if (q.trim().length < 2) { setAchados([]); return }
    const termo = q.trim().replace(/[%,()]/g, '')
    const digitos = termo.replace(/\D/g, '')
    const { data } = await supabase.from('leads').select('id, nome, sobrenome, telefone')
      .eq('unit_id', unitId).eq('arquivado', false)
      .or(digitos.length >= 4 ? `nome.ilike.%${termo}%,telefone_norm.like.%${digitos}%` : `nome.ilike.%${termo}%`)
      .limit(8)
    setAchados((data ?? []) as typeof achados)
  }

  async function vincular(leadId: string) {
    setErro(null)
    const { error } = await supabase.from('empresa_vinculos').insert({ empresa_id: empresa.id, lead_id: leadId, papel: 'contato' })
    if (error && error.code !== '23505') { setErro(`Não foi possível vincular: ${error.message}`); return }
    setBusca(''); setAchados([])
    await carregar()
    onAlterada({ id: empresa.id, contatos: (detalhe?.vinculos.length ?? 0) + (error ? 0 : 1) })
  }

  async function mudarPapel(leadId: string, papel: PapelNaEmpresa) {
    const { error } = await supabase.from('empresa_vinculos').update({ papel }).eq('empresa_id', empresa.id).eq('lead_id', leadId)
    if (error) { setErro(error.message); return }
    await carregar()
  }

  async function desvincular(leadId: string) {
    const { error } = await supabase.from('empresa_vinculos').delete().eq('empresa_id', empresa.id).eq('lead_id', leadId)
    if (error) { setErro(error.message); return }
    await carregar()
    onAlterada({ id: empresa.id, contatos: Math.max(0, (detalhe?.vinculos.length ?? 1) - 1) })
  }

  async function apagar() {
    if (!confirm(`Apagar a empresa "${empresa.nome}"? Os contatos continuam; os tickets e grupos ficam sem empresa.`)) return
    const { error, count } = await supabase.from('empresas').delete({ count: 'exact' }).eq('id', empresa.id)
    if (error || !count) { setErro(error?.message ?? 'Só o gestor apaga empresas.'); return }
    onApagada()
  }

  return (
    <div style={{ flex: '2 1 420px', minWidth: 320, background: '#fff', border: `1px solid ${COR.borda}`, borderRadius: 12, padding: '16px 18px' }}>
      {erro && <div role="alert" style={{ padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 9, fontSize: 12.5, color: COR.erro, marginBottom: 10 }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 2 }}>
          <label style={{ ...rotulo, marginTop: 0 }} htmlFor="f-nome">Nome</label>
          <input id="f-nome" style={campo} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ ...rotulo, marginTop: 0 }} htmlFor="f-cnpj">CNPJ</label>
          <input id="f-cnpj" style={campo} value={form.cnpj} onChange={e => setForm({ ...form, cnpj: e.target.value })} />
        </div>
      </div>
      <label style={rotulo} htmlFor="f-resp">Responsável</label>
      <select id="f-resp" style={campo} value={form.responsavel_id} onChange={e => setForm({ ...form, responsavel_id: e.target.value })}>
        <option value="">Sem responsável</option>
        {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
      </select>
      <label style={rotulo} htmlFor="f-obs">Observação</label>
      <textarea id="f-obs" style={{ ...campo, minHeight: 60, resize: 'vertical' }} value={form.observacao} onChange={e => setForm({ ...form, observacao: e.target.value })} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button style={botao} onClick={() => void salvar()}>Salvar</button>
        {gestor && <button style={{ ...botaoLeve, color: COR.erro }} onClick={() => void apagar()}>Apagar empresa</button>}
      </div>

      <p style={{ margin: '20px 0 6px', fontSize: 13.5, fontWeight: 800, color: COR.tinta }}>Contatos</p>
      {detalhe?.vinculos.length === 0 && <p style={{ fontSize: 12, color: COR.fraco, margin: '0 0 8px' }}>Nenhum contato vinculado.</p>}
      {detalhe?.vinculos.map(v => (
        <div key={v.lead_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: `1px solid ${COR.borda}` }}>
          <Link href={`/funil?lead=${v.lead_id}`} style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: COR.tinta, textDecoration: 'none' }}>
            {[v.lead?.nome, v.lead?.sobrenome].filter(Boolean).join(' ')}
            <span style={{ fontWeight: 400, color: COR.fraco }}>{v.lead?.telefone ? ` · ${v.lead.telefone}` : ''}</span>
          </Link>
          <select value={v.papel} onChange={e => void mudarPapel(v.lead_id, e.target.value as PapelNaEmpresa)} aria-label="Papel na empresa" style={{ ...campo, width: 'auto', padding: '4px 6px', fontSize: 12 }}>
            {(Object.keys(PAPEL_NA_EMPRESA_LABELS) as PapelNaEmpresa[]).map(p => <option key={p} value={p}>{PAPEL_NA_EMPRESA_LABELS[p]}</option>)}
          </select>
          <button style={botaoLeve} onClick={() => void desvincular(v.lead_id)}>Desvincular</button>
        </div>
      ))}
      <input style={{ ...campo, marginTop: 8 }} placeholder="Vincular contato: busque por nome ou telefone" value={busca}
        aria-label="Buscar contato para vincular" onChange={e => void buscarLeads(e.target.value)} />
      {achados.map(l => (
        <button key={l.id} onClick={() => void vincular(l.id)}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: `1px solid ${COR.borda}`, borderTop: 'none', background: '#fff', cursor: 'pointer', fontSize: 12.5, color: COR.tinta }}>
          {[l.nome, l.sobrenome].filter(Boolean).join(' ')} <span style={{ color: COR.fraco }}>{l.telefone ?? ''}</span>
        </button>
      ))}

      {detalhe && detalhe.grupos.length > 0 && (
        <>
          <p style={{ margin: '20px 0 6px', fontSize: 13.5, fontWeight: 800, color: COR.tinta }}>Grupos de WhatsApp</p>
          {detalhe.grupos.map(g => (
            <Link key={g.id} href={`/atendimento?conversa=${g.id}`} style={{ display: 'block', fontSize: 12.5, color: COR.tinta, padding: '5px 0' }}>👥 {g.wa_contact_name ?? 'Grupo'}</Link>
          ))}
        </>
      )}

      {ticketsLigado && (
        <>
          <p style={{ margin: '20px 0 6px', fontSize: 13.5, fontWeight: 800, color: COR.tinta }}>Tickets</p>
          {detalhe?.tickets.length === 0 && <p style={{ fontSize: 12, color: COR.fraco, margin: 0 }}>Nenhum ticket.</p>}
          {detalhe?.tickets.map(t => (
            <Link key={t.id} href={`/tickets?ticket=${t.id}`} style={{ display: 'block', fontSize: 12.5, color: COR.tinta, padding: '5px 0' }}>
              #{t.numero} {t.titulo}{t.status === 'resolvido' ? ' ✓' : ''}
            </Link>
          ))}
        </>
      )}
    </div>
  )
}
