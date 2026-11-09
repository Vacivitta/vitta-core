'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CampoLead, CamposDoLead } from '@/types/database'
import {
  camposDoFunil, comValor, entradaInicial, formatarValor, separarCampos, valorDaEntrada, type EntradaCampo,
} from '@/lib/campos'

/** Onde ficam os valores: o negócio (e a pessoa dele) ou só a pessoa (ficha do contato) */
export type DonoDosCampos = { leadId: string } | { contatoId: string }

/**
 * Definições da unidade e valores do negócio e da pessoa (151). As views do funil
 * não trazem leads.campos: a ficha lê das tabelas ao abrir. Fica no LeadModal
 * para o painel esquerdo (desktop) e a aba Informações (celular) dividirem o
 * mesmo estado. `valores` junta os dois lados (as chaves são únicas na unidade).
 */
export function useCamposLead(dono: DonoDosCampos, unitId: string | null) {
  const [definicoes, setDefinicoes] = useState<CampoLead[]>([])
  const [valores, setValores] = useState<CamposDoLead>({})
  const [contatoId, setContatoId] = useState<string | null>('contatoId' in dono ? dono.contatoId : null)
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const chaveDono = 'leadId' in dono ? `l:${dono.leadId}` : `c:${dono.contatoId}`

  useEffect(() => {
    let vivo = true
    const supabase = createClient()
    const valoresDoDono = 'leadId' in dono
      ? supabase.from('leads').select('campos, contato:contatos(id, campos)').eq('id', dono.leadId).maybeSingle()
          .then(({ data, error }) => {
            const l = data as { campos?: CamposDoLead; contato?: { id: string; campos: CamposDoLead } | null } | null
            return { error, contatoId: l?.contato?.id ?? null, valores: { ...(l?.campos ?? {}), ...(l?.contato?.campos ?? {}) } }
          })
      : supabase.from('contatos').select('id, campos').eq('id', dono.contatoId).maybeSingle()
          .then(({ data, error }) => ({ error, contatoId: dono.contatoId, valores: ((data?.campos ?? {}) as CamposDoLead) }))
    Promise.all([
      unitId
        ? supabase.from('campos_lead').select('*').eq('unit_id', unitId).eq('ativo', true)
        : Promise.resolve({ data: [], error: null }),
      valoresDoDono,
    ]).then(([defs, lidos]) => {
      if (!vivo) return
      if (defs.error || lidos.error) setErroCarga('Não foi possível carregar as informações.')
      setDefinicoes((defs.data ?? []) as CampoLead[])
      setValores(lidos.valores)
      setContatoId(lidos.contatoId)
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [chaveDono, unitId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Grava o lado do campo trocado: o da pessoa no contato, o do negócio no lead */
  async function gravar(campo: CampoLead, novos: CamposDoLead): Promise<string | null> {
    const lados = separarCampos(definicoes, novos)
    const supabase = createClient()
    let erro: string | null = null
    if (campo.objeto === 'contato') {
      if (!contatoId) erro = 'Este negócio ainda não tem contato.'
      else erro = (await supabase.from('contatos').update({ campos: lados.pessoa }).eq('id', contatoId)).error?.message ?? null
    } else if ('leadId' in dono) {
      erro = (await supabase.from('leads').update({ campos: lados.negocio }).eq('id', dono.leadId)).error?.message ?? null
    } else {
      erro = 'Campo do negócio: edite na ficha do negócio.'
    }
    if (!erro) setValores(novos)
    return erro
  }

  return { definicoes, valores, setValores, carregando, erroCarga, gravar, soDaPessoa: !('leadId' in dono) }
}

type EstadoCampos = ReturnType<typeof useCamposLead>

interface Props {
  funnelId: string | null
  estado: EstadoCampos
}

export const inputStyle: React.CSSProperties = {
  width: '100%', borderRadius: 9, border: '1px solid #EBE7DA', padding: '5px 8px', fontSize: 12,
  outline: 'none', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box', color: '#25402C',
}

export default function CamposLead({ funnelId, estado }: Props) {
  const { definicoes, valores, carregando, erroCarga, gravar, soDaPessoa } = estado
  const [editando, setEditando] = useState<string | null>(null)
  const [entrada, setEntrada] = useState<EntradaCampo>('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Na ficha do contato, só os da pessoa; no negócio, os dois (os da pessoa valem para todos os negócios dela)
  const campos = camposDoFunil(definicoes, funnelId).filter(c => !soDaPessoa || c.objeto === 'contato')

  if (carregando) return <p style={{ fontSize: 12, color: '#9AA79C', margin: 0 }}>Carregando…</p>
  if (erroCarga) return <p style={{ fontSize: 12, color: '#C4534A', margin: 0 }}>{erroCarga}</p>
  if (campos.length === 0) {
    return (
      <p style={{ fontSize: 12, color: '#9AA79C', fontStyle: 'italic', margin: 0 }}>
        {soDaPessoa ? 'Nenhum campo da pessoa configurado.' : 'Nenhum campo configurado para este funil.'}
      </p>
    )
  }

  function abrir(c: CampoLead) {
    setEditando(c.chave)
    setEntrada(entradaInicial(c, valores[c.chave]))
    setErro(null)
  }

  async function salvar(c: CampoLead) {
    const r = valorDaEntrada(c, entrada)
    if (!r.ok) { setErro(r.erro); return }
    const novos = comValor(valores, c.chave, r.valor)
    setSalvando(true)
    const falha = await gravar(c, novos)
    setSalvando(false)
    // A mensagem do trigger (23514) já diz qual campo e por quê
    if (falha) { setErro(falha); return }
    setEditando(null)
  }

  function teclas(e: React.KeyboardEvent, c: CampoLead) {
    if (e.key === 'Escape') setEditando(null)
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void salvar(c) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {campos.map(c => {
        const exibido = formatarValor(c, valores[c.chave])
        if (editando === c.chave) {
          return (
            <div key={c.id} onKeyDown={e => teclas(e, c)} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#71856F' }}>{c.rotulo}</span>
              <EditorCampo campo={c} entrada={entrada} onChange={setEntrada} />
              {erro && <span role="alert" style={{ fontSize: 11.5, color: '#C4534A' }}>{erro}</span>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => salvar(c)} disabled={salvando}
                  style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 12px', borderRadius: 99, border: 'none', background: '#3E9849', color: '#fff', cursor: 'pointer', opacity: salvando ? 0.6 : 1 }}>
                  Salvar
                </button>
                <button type="button" onClick={() => setEditando(null)}
                  style={{ fontSize: 11.5, fontWeight: 700, background: 'none', border: 'none', color: '#9AA79C', cursor: 'pointer' }}>
                  Cancelar
                </button>
              </div>
            </div>
          )
        }
        return (
          <button key={c.id} type="button" onClick={() => abrir(c)} title="Editar"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#71856F', width: 110, flexShrink: 0 }}
              title={c.objeto === 'contato' && !soDaPessoa ? 'Da pessoa: vale para todos os negócios dela' : undefined}>
              {c.rotulo}{c.objeto === 'contato' && !soDaPessoa ? ' ·' : ''}
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: exibido ? '#25402C' : '#C9C3B3', flex: 1, minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
              {exibido || 'Adicionar'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Editor do valor conforme o tipo do campo (também no modal de campos exigidos pela etapa). */
export function EditorCampo({ campo, entrada, onChange, autoFocus = true }: {
  campo:      CampoLead
  entrada:    EntradaCampo
  onChange:   (entrada: EntradaCampo) => void
  autoFocus?: boolean
}) {
  const texto = typeof entrada === 'string' ? entrada : ''
  switch (campo.tipo) {
    case 'selecao':
      return (
        <select style={inputStyle} value={texto} autoFocus={autoFocus} onChange={e => onChange(e.target.value)}>
          <option value="">—</option>
          {campo.opcoes.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    case 'multipla': {
      const marcadas = Array.isArray(entrada) ? entrada : []
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {campo.opcoes.map(o => (
            <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
              <input type="checkbox" checked={marcadas.includes(o)}
                onChange={e => onChange(e.target.checked ? [...marcadas, o] : marcadas.filter(x => x !== o))} />
              {o}
            </label>
          ))}
        </div>
      )
    }
    case 'sim_nao':
      return (
        <select style={inputStyle} autoFocus={autoFocus} value={entrada === true ? 'sim' : entrada === false ? 'nao' : ''}
          onChange={e => onChange(e.target.value === 'sim' ? true : e.target.value === 'nao' ? false : '')}>
          <option value="">—</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </select>
      )
    case 'data':
      return <input type="date" style={inputStyle} autoFocus={autoFocus} value={texto} onChange={e => onChange(e.target.value)} />
    case 'numero':
    case 'moeda':
      return <input type="text" inputMode="decimal" style={inputStyle} autoFocus={autoFocus} value={texto}
        placeholder={campo.tipo === 'moeda' ? '0,00' : ''} onChange={e => onChange(e.target.value)} />
    case 'telefone':
      return <input type="tel" style={inputStyle} autoFocus={autoFocus} value={texto} onChange={e => onChange(e.target.value)} />
    case 'email':
      return <input type="email" style={inputStyle} autoFocus={autoFocus} value={texto} onChange={e => onChange(e.target.value)} />
    case 'texto':
      return <textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} autoFocus={autoFocus} value={texto}
        onChange={e => onChange(e.target.value)} />
  }
}
