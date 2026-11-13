'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CampoLead, Funnel, TipoCampo } from '@/types/database'
import { OBJETO_CAMPO_LABELS, TIPOS_CAMPO, TIPO_CAMPO_LABELS, chaveDoRotulo, opcoesValidas, tipoTemOpcoes } from '@/lib/campos'
import type { ObjetoCampo } from '@/types/database'

interface Props {
  unitId: string
  initialCampos: CampoLead[]
  funis: Pick<Funnel, 'id' | 'nome'>[]
}

interface Rascunho {
  rotulo:   string
  tipo:     TipoCampo
  opcoes:   string
  funnelId: string
  /** Da pessoa (vale para todos os negócios dela, sem funil) ou do negócio (151) */
  objeto:   ObjetoCampo
}

const RASCUNHO_VAZIO: Rascunho = { rotulo: '', tipo: 'texto', opcoes: '', funnelId: '', objeto: 'negocio' }

/** Uma opção por linha; espaços nas pontas e linhas vazias ou repetidas saem. */
function lerOpcoes(texto: string): string[] {
  return [...new Set(texto.split('\n').map(o => o.trim()).filter(Boolean))]
}

function erroDoRascunho(r: Rascunho): string | null {
  if (!r.rotulo.trim()) return 'Dê um nome ao campo'
  if (r.rotulo.trim().length > 80) return 'Nome com até 80 caracteres'
  if (tipoTemOpcoes(r.tipo) && !opcoesValidas(lerOpcoes(r.opcoes))) {
    return 'Informe de 1 a 100 opções (uma por linha, até 100 caracteres cada)'
  }
  return null
}

function ordenar(lista: CampoLead[]): CampoLead[] {
  return [...lista].sort((a, b) => a.ordem - b.ordem || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

const inputStyle: React.CSSProperties = {
  width: '100%', borderRadius: 10, border: '1px solid #E9E5D8', padding: '8px 12px', fontSize: 13,
  outline: 'none', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box', color: '#25402C',
}
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: '#71856F', marginBottom: 5 }
const botaoPrimario: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 10, border: 'none', background: '#3E9849', color: '#fff',
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
}
const botaoLink: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#71856F', padding: '4px 6px',
}

export default function CamposClient({ unitId, initialCampos, funis }: Props) {
  const supabase = createClient()
  const [campos, setCampos] = useState<CampoLead[]>(ordenar(initialCampos))
  const [novo, setNovo] = useState<Rascunho>(RASCUNHO_VAZIO)
  const [editId, setEditId] = useState<string | null>(null)
  const [edicao, setEdicao] = useState<Rascunho>(RASCUNHO_VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const nomeDoFunil = (id: string | null) => id ? funis.find(f => f.id === id)?.nome ?? 'Funil removido' : 'Todos os funis'

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    const invalido = erroDoRascunho(novo)
    if (invalido) { setErro(invalido); return }
    setSalvando(true); setErro('')
    const { data, error } = await supabase.from('campos_lead').insert({
      unit_id:   unitId,
      objeto:    novo.objeto,
      funnel_id: novo.objeto === 'contato' ? null : novo.funnelId || null,
      rotulo:    novo.rotulo.trim(),
      tipo:      novo.tipo,
      opcoes:    tipoTemOpcoes(novo.tipo) ? lerOpcoes(novo.opcoes) : null,
      ordem:     campos.length ? Math.max(...campos.map(c => c.ordem)) + 1 : 0,
    }).select().single()
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setCampos(prev => ordenar([...prev, data as CampoLead]))
    setNovo(RASCUNHO_VAZIO)
  }

  function abrirEdicao(c: CampoLead) {
    setEditId(c.id)
    setEdicao({ rotulo: c.rotulo, tipo: c.tipo, opcoes: (c.opcoes ?? []).join('\n'), funnelId: c.funnel_id ?? '', objeto: c.objeto })
    setErro('')
  }

  async function salvarEdicao(c: CampoLead) {
    const invalido = erroDoRascunho(edicao)
    if (invalido) { setErro(invalido); return }
    setSalvando(true); setErro('')
    const { data, error } = await supabase.from('campos_lead').update({
      rotulo:    edicao.rotulo.trim(),
      funnel_id: c.objeto === 'contato' ? null : edicao.funnelId || null,
      opcoes:    tipoTemOpcoes(c.tipo) ? lerOpcoes(edicao.opcoes) : null,
    }).eq('id', c.id).select().single()
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setCampos(prev => ordenar(prev.map(x => x.id === c.id ? data as CampoLead : x)))
    setEditId(null)
  }

  async function alternarAtivo(c: CampoLead) {
    setErro('')
    const { error } = await supabase.from('campos_lead').update({ ativo: !c.ativo }).eq('id', c.id)
    if (error) { setErro(error.message); return }
    setCampos(prev => prev.map(x => x.id === c.id ? { ...x, ativo: !c.ativo } : x))
  }

  // Regrava a ordem de todos (0, 1, 2...): campos antigos podem ter a mesma ordem
  async function mover(indice: number, delta: -1 | 1) {
    const destino = indice + delta
    if (destino < 0 || destino >= campos.length) return
    const nova = [...campos]
    ;[nova[indice], nova[destino]] = [nova[destino], nova[indice]]
    const renumerada = nova.map((c, i) => ({ ...c, ordem: i }))
    const mudaram = renumerada.filter(c => campos.find(x => x.id === c.id)?.ordem !== c.ordem)
    setCampos(renumerada)
    setErro('')
    const resultados = await Promise.all(
      mudaram.map(c => supabase.from('campos_lead').update({ ordem: c.ordem }).eq('id', c.id)),
    )
    const falha = resultados.find(r => r.error)
    if (falha?.error) { setErro(falha.error.message); setCampos(campos) }
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#25402C', margin: '0 0 4px', letterSpacing: '-0.01em' }}>
        Campos personalizados
      </h1>
      <p style={{ fontSize: 14, color: '#9AA79C', marginBottom: 28 }}>
        Informações que a equipe preenche na ficha (ex.: convênio, vacinas de interesse, capital disponível).
        Campo <strong>da pessoa</strong> (convênio, alergias) é um valor só para todos os negócios dela e aparece também na
        ficha do contato; campo <strong>do negócio</strong> (vacinas de interesse, valor pretendido) é de cada oportunidade
        e pode valer para todos os funis ou só para um. Campos desativados somem da ficha, mas os valores ficam guardados.
      </p>

      <form onSubmit={criar} style={{ background: '#fff', border: '1px solid #EBE7DA', borderRadius: 16, padding: 18, marginBottom: 28, display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={labelStyle}>Nome do campo</label>
            <input style={inputStyle} value={novo.rotulo} maxLength={80} placeholder="Ex.: Convênio"
              onChange={e => setNovo(r => ({ ...r, rotulo: e.target.value }))} />
            {novo.rotulo.trim() && (
              <span style={{ fontSize: 11, color: '#9AA79C' }}>Chave: {chaveDoRotulo(novo.rotulo)}</span>
            )}
          </div>
          <div>
            <label style={labelStyle}>Tipo</label>
            <select style={inputStyle} value={novo.tipo} onChange={e => setNovo(r => ({ ...r, tipo: e.target.value as TipoCampo }))}>
              {TIPOS_CAMPO.map(t => <option key={t} value={t}>{TIPO_CAMPO_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>De quem é</label>
            <select style={inputStyle} value={novo.objeto}
              onChange={e => setNovo(r => ({ ...r, objeto: e.target.value as ObjetoCampo, funnelId: '' }))}>
              <option value="negocio">{OBJETO_CAMPO_LABELS.negocio}</option>
              <option value="contato">{OBJETO_CAMPO_LABELS.contato}</option>
            </select>
          </div>
          {novo.objeto === 'negocio' && (
            <div>
              <label style={labelStyle}>Funil</label>
              <select style={inputStyle} value={novo.funnelId} onChange={e => setNovo(r => ({ ...r, funnelId: e.target.value }))}>
                <option value="">Todos os funis</option>
                {funis.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </div>
          )}
        </div>
        {tipoTemOpcoes(novo.tipo) && (
          <div>
            <label style={labelStyle}>Opções (uma por linha)</label>
            <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={novo.opcoes}
              placeholder={'Unimed\nBradesco\nParticular'}
              onChange={e => setNovo(r => ({ ...r, opcoes: e.target.value }))} />
          </div>
        )}
        <div>
          <button type="submit" disabled={salvando} style={{ ...botaoPrimario, opacity: salvando ? 0.6 : 1 }}>
            Criar campo
          </button>
        </div>
      </form>

      {erro && (
        <p role="alert" style={{ fontSize: 13, color: '#C4534A', background: '#FDF1F2', border: '1px solid #F2C9C5', borderRadius: 10, padding: '8px 12px', marginBottom: 16 }}>
          {erro}
        </p>
      )}

      {campos.length === 0 ? (
        <p style={{ fontSize: 13, color: '#9AA79C', fontStyle: 'italic' }}>Nenhum campo criado ainda.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {campos.map((c, i) => (
            <li key={c.id} style={{ background: '#fff', border: '1px solid #EBE7DA', borderRadius: 14, padding: '12px 14px', opacity: c.ativo ? 1 : 0.6 }}>
              {editId === c.id ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                    <div>
                      <label style={labelStyle}>Nome</label>
                      <input style={inputStyle} value={edicao.rotulo} maxLength={80} autoFocus
                        onChange={e => setEdicao(r => ({ ...r, rotulo: e.target.value }))} />
                    </div>
                    {c.objeto === 'negocio' && (
                      <div>
                        <label style={labelStyle}>Funil</label>
                        <select style={inputStyle} value={edicao.funnelId} onChange={e => setEdicao(r => ({ ...r, funnelId: e.target.value }))}>
                          <option value="">Todos os funis</option>
                          {funis.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                  {tipoTemOpcoes(c.tipo) && (
                    <div>
                      <label style={labelStyle}>Opções (uma por linha)</label>
                      <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={edicao.opcoes}
                        onChange={e => setEdicao(r => ({ ...r, opcoes: e.target.value }))} />
                      <span style={{ fontSize: 11, color: '#9AA79C' }}>
                        Tirar uma opção não apaga o que já foi gravado.
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => salvarEdicao(c)} disabled={salvando} style={{ ...botaoPrimario, opacity: salvando ? 0.6 : 1 }}>Salvar</button>
                    <button type="button" onClick={() => setEditId(null)} style={botaoLink}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <button type="button" aria-label={`Subir ${c.rotulo}`} onClick={() => mover(i, -1)} disabled={i === 0} style={{ ...botaoLink, padding: '0 4px', opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                    <button type="button" aria-label={`Descer ${c.rotulo}`} onClick={() => mover(i, 1)} disabled={i === campos.length - 1} style={{ ...botaoLink, padding: '0 4px', opacity: i === campos.length - 1 ? 0.3 : 1 }}>▼</button>
                  </div>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#25402C' }}>
                      {c.rotulo}
                      {!c.ativo && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#9AA79C' }}>desativado</span>}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9AA79C' }}>
                      {TIPO_CAMPO_LABELS[c.tipo]} · {OBJETO_CAMPO_LABELS[c.objeto]}
                      {c.objeto === 'negocio' ? ` · ${nomeDoFunil(c.funnel_id)}` : ''} · chave <code>{c.chave}</code>
                    </p>
                    {c.opcoes && (
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#71856F' }}>{c.opcoes.join(' · ')}</p>
                    )}
                  </div>
                  <button type="button" onClick={() => abrirEdicao(c)} style={botaoLink}>Editar</button>
                  <button type="button" onClick={() => alternarAtivo(c)} style={{ ...botaoLink, color: c.ativo ? '#C4534A' : '#35853F' }}>
                    {c.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
