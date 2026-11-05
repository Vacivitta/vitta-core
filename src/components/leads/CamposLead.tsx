'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CampoLead, CamposDoLead } from '@/types/database'
import {
  camposDoFunil, comValor, entradaInicial, formatarValor, valorDaEntrada, type EntradaCampo,
} from '@/lib/campos'

/**
 * Definições da unidade e valores do lead. As views do funil não trazem
 * leads.campos: a ficha lê da tabela ao abrir. Fica no LeadModal para o painel
 * esquerdo (desktop) e a aba Informações (celular) dividirem o mesmo estado.
 */
export function useCamposLead(leadId: string, unitId: string | null) {
  const [definicoes, setDefinicoes] = useState<CampoLead[]>([])
  const [valores, setValores] = useState<CamposDoLead>({})
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    const supabase = createClient()
    Promise.all([
      unitId
        ? supabase.from('campos_lead').select('*').eq('unit_id', unitId).eq('ativo', true)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('leads').select('campos').eq('id', leadId).maybeSingle(),
    ]).then(([defs, lead]) => {
      if (!vivo) return
      if (defs.error || lead.error) setErroCarga('Não foi possível carregar as informações.')
      setDefinicoes((defs.data ?? []) as CampoLead[])
      setValores(((lead.data as { campos?: CamposDoLead } | null)?.campos) ?? {})
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [leadId, unitId])

  return { definicoes, valores, setValores, carregando, erroCarga }
}

type EstadoCampos = ReturnType<typeof useCamposLead>

interface Props {
  leadId: string
  funnelId: string | null
  estado: EstadoCampos
}

export const inputStyle: React.CSSProperties = {
  width: '100%', borderRadius: 9, border: '1px solid #EBE7DA', padding: '5px 8px', fontSize: 12,
  outline: 'none', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box', color: '#25402C',
}

export default function CamposLead({ leadId, funnelId, estado }: Props) {
  const { definicoes, valores, setValores, carregando, erroCarga } = estado
  const [editando, setEditando] = useState<string | null>(null)
  const [entrada, setEntrada] = useState<EntradaCampo>('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const campos = camposDoFunil(definicoes, funnelId)

  if (carregando) return <p style={{ fontSize: 12, color: '#9AA79C', margin: 0 }}>Carregando…</p>
  if (erroCarga) return <p style={{ fontSize: 12, color: '#C4534A', margin: 0 }}>{erroCarga}</p>
  if (campos.length === 0) {
    return <p style={{ fontSize: 12, color: '#9AA79C', fontStyle: 'italic', margin: 0 }}>Nenhum campo configurado para este funil.</p>
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
    const { error } = await createClient().from('leads').update({ campos: novos }).eq('id', leadId)
    setSalvando(false)
    // A mensagem do trigger (23514) já diz qual campo e por quê
    if (error) { setErro(error.message); return }
    setValores(novos)
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
            <span style={{ fontSize: 12, fontWeight: 700, color: '#71856F', width: 110, flexShrink: 0 }}>{c.rotulo}</span>
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
