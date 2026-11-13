'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CampoLead, CamposDoLead, Profile } from '@/types/database'
import { ORIGEM_OPTIONS } from '@/types/database'
import { comValor, separarCampos, valorDaEntrada, entradaInicial, type EntradaCampo } from '@/lib/campos'
import { campoFixo, rotuloObrigatorio, type CampoFixo, type ValoresFixos } from '@/lib/obrigatorios'
import { avisoTelefone, telefoneParaGravar } from '@/lib/telefone'
import { isViolacaoUnica } from '@/lib/supabase/erros'
import { EditorCampo, inputStyle } from './CamposLead'

export interface Preenchido {
  fixos:  ValoresFixos
  campos: CamposDoLead
}

type Item =
  | { kind: 'fixo'; chave: string; fixo: CampoFixo }
  | { kind: 'campo'; chave: string; def: CampoLead }

interface Props {
  leadId:    string
  unitId:    string | null
  funnelId:  string | null
  etapaNome: string
  /** Chaves que o banco devolveu no erro VC001 (faltandoDoErro) */
  faltando:  string[]
  /** Para "Responsável"; sem a lista, o modal busca os perfis da unidade */
  profiles?: Pick<Profile, 'id' | 'full_name'>[]
  onCancelar: () => void
  /** Os valores já foram gravados no lead; quem abriu tenta mover de novo */
  onPreenchido: (valores: Preenchido) => Promise<void>
}

/**
 * Pede os campos que a etapa exige (migração 130), grava no lead e devolve a
 * vez para quem tentou mover.
 */
export default function PreencherObrigatorios({
  leadId, unitId, funnelId, etapaNome, faltando, profiles, onCancelar, onPreenchido,
}: Props) {
  const [definicoes, setDefinicoes] = useState<CampoLead[]>([])
  // Negócio e pessoa juntos (151); ao gravar, cada lado vai para a sua tabela
  const [camposAtuais, setCamposAtuais] = useState<CamposDoLead>({})
  const [contatoId, setContatoId] = useState<string | null>(null)
  const [perfis, setPerfis] = useState(profiles ?? [])
  const [carregando, setCarregando] = useState(true)
  const [fixos, setFixos] = useState<Record<string, string>>({})
  const [entradas, setEntradas] = useState<Record<string, EntradaCampo>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const precisaPerfis = !profiles && faltando.includes('lead:responsavel_id')

  useEffect(() => {
    let vivo = true
    const supabase = createClient()
    Promise.all([
      unitId
        ? supabase.from('campos_lead').select('*').eq('unit_id', unitId).eq('ativo', true)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('leads').select('campos, contato:contatos(id, campos)').eq('id', leadId).maybeSingle(),
      precisaPerfis && unitId
        ? supabase.from('profiles').select('id, full_name').eq('unit_id', unitId).eq('ativo', true).order('full_name')
        : Promise.resolve({ data: null, error: null }),
    ]).then(([defs, lead, perfisDaUnidade]) => {
      if (!vivo) return
      if (defs.error || lead.error) setErro('Não foi possível carregar os campos. Feche e tente de novo.')
      const lista = (defs.data ?? []) as CampoLead[]
      const l = lead.data as { campos?: CamposDoLead; contato?: { id: string; campos: CamposDoLead } | null } | null
      const atuais = { ...(l?.campos ?? {}), ...(l?.contato?.campos ?? {}) }
      setContatoId(l?.contato?.id ?? null)
      setDefinicoes(lista)
      setCamposAtuais(atuais)
      setEntradas(Object.fromEntries(lista.map(d => [d.chave, entradaInicial(d, atuais[d.chave])])))
      if (perfisDaUnidade.data) setPerfis(perfisDaUnidade.data as Pick<Profile, 'id' | 'full_name'>[])
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [leadId, unitId, precisaPerfis])

  const itens = faltando.flatMap((chave): Item[] => {
    const fixo = campoFixo(chave)
    if (fixo) return [{ kind: 'fixo', chave, fixo }]
    const def = definicoes.find(d => d.chave === chave && (d.funnel_id === null || d.funnel_id === funnelId))
    return def ? [{ kind: 'campo', chave, def }] : []
  })

  async function salvar() {
    setErro(null)
    const valoresFixos: ValoresFixos = {}
    let campos = camposAtuais
    for (const item of itens) {
      if (item.kind === 'fixo') {
        const texto = (fixos[item.fixo.coluna] ?? '').trim()
        if (!texto) { setErro(`Preencha ${item.fixo.rotulo}.`); return }
        if (item.fixo.coluna === 'telefone') {
          const aviso = avisoTelefone(texto)
          if (aviso) { setErro(aviso); return }
          valoresFixos.telefone = telefoneParaGravar(texto)
        } else {
          valoresFixos[item.fixo.coluna] = item.fixo.coluna === 'email' ? texto.toLowerCase() : texto
        }
      } else {
        const r = valorDaEntrada(item.def, entradas[item.chave] ?? '')
        if (!r.ok) { setErro(`${item.def.rotulo}: ${r.erro}`); return }
        if (r.valor === null) { setErro(`Preencha ${item.def.rotulo}.`); return }
        campos = comValor(campos, item.chave, r.valor)
      }
    }

    setSalvando(true)
    const mudouCampos = itens.some(i => i.kind === 'campo')
    const lados = separarCampos(definicoes, campos)
    const mudouPessoa = itens.some(i => i.kind === 'campo' && i.def.objeto === 'contato')
    const mudouNegocio = itens.some(i => i.kind === 'campo' && i.def.objeto !== 'contato')
    const supabase = createClient()
    // A pessoa antes: quem abriu o modal tenta mover de novo e a etapa lê o contato
    const errPessoa = mudouPessoa && contatoId
      ? (await supabase.from('contatos').update({ campos: lados.pessoa }).eq('id', contatoId)).error
      : null
    const { error } = errPessoa
      ? { error: errPessoa }
      : await supabase.from('leads')
          .update(mudouCampos && mudouNegocio ? { ...valoresFixos, campos: lados.negocio } : valoresFixos)
          .eq('id', leadId)
    if (error) {
      setSalvando(false)
      setErro(isViolacaoUnica(error)
        ? 'Já existe outro contato com este telefone nesta unidade.'
        : error.message)
      return
    }
    setCamposAtuais(campos)
    try {
      await onPreenchido({ fixos: valoresFixos, campos })
    } finally {
      setSalvando(false)
    }
  }

  function inputFixo(fixo: CampoFixo, primeiro: boolean) {
    const valor = fixos[fixo.coluna] ?? ''
    const mudar = (v: string) => setFixos(prev => ({ ...prev, [fixo.coluna]: v }))
    switch (fixo.coluna) {
      case 'origem':
        return (
          <select style={inputStyle} autoFocus={primeiro} value={valor} onChange={e => mudar(e.target.value)}>
            <option value="">—</option>
            {ORIGEM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )
      case 'responsavel_id':
        return (
          <select style={inputStyle} autoFocus={primeiro} value={valor} onChange={e => mudar(e.target.value)}>
            <option value="">—</option>
            {perfis.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        )
      case 'data_nascimento':
        return <input type="date" style={inputStyle} autoFocus={primeiro} value={valor} onChange={e => mudar(e.target.value)} />
      case 'email':
        return <input type="email" style={inputStyle} autoFocus={primeiro} value={valor} onChange={e => mudar(e.target.value)} />
      case 'telefone':
        return <input type="tel" style={inputStyle} autoFocus={primeiro} value={valor} onChange={e => mudar(e.target.value)} />
      default:
        return <input type="text" style={inputStyle} autoFocus={primeiro} value={valor} onChange={e => mudar(e.target.value)} />
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Campos exigidos para ${etapaNome}`}
      onClick={e => { if (e.target === e.currentTarget && !salvando) onCancelar() }}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto', padding: '18px 20px', boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: '#25402C', margin: '0 0 4px' }}>
          Para mover para {etapaNome}, preencha:
        </h2>
        <p style={{ fontSize: 12, color: '#9AA79C', margin: '0 0 14px' }}>
          O gestor definiu estes campos como obrigatórios para esta etapa.
        </p>

        {carregando ? (
          <p style={{ fontSize: 12, color: '#9AA79C' }}>Carregando…</p>
        ) : itens.length === 0 ? (
          <p style={{ fontSize: 12, color: '#C4534A' }}>
            Faltam: {faltando.map(c => rotuloObrigatorio(c, definicoes)).join(', ')}. Esses campos não podem ser
            editados aqui; fale com o gestor.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {itens.map((item, i) => (
              <div key={item.chave} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#71856F' }}>
                  {item.kind === 'fixo' ? item.fixo.rotulo : item.def.rotulo}
                </span>
                {item.kind === 'fixo'
                  ? inputFixo(item.fixo, i === 0)
                  : <EditorCampo campo={item.def} autoFocus={i === 0} entrada={entradas[item.chave] ?? ''}
                      onChange={v => setEntradas(prev => ({ ...prev, [item.chave]: v }))} />}
              </div>
            ))}
          </div>
        )}

        {erro && <p role="alert" style={{ fontSize: 12, color: '#C4534A', margin: '12px 0 0' }}>{erro}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={() => void salvar()} disabled={salvando || carregando || itens.length === 0}
            style={{ flex: 1, padding: '9px', fontSize: 13, fontWeight: 700, background: '#3E9849', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', opacity: salvando || carregando || itens.length === 0 ? 0.6 : 1 }}>
            {salvando ? 'Salvando…' : 'Salvar e mover'}
          </button>
          <button type="button" onClick={onCancelar} disabled={salvando}
            style={{ padding: '9px 16px', fontSize: 13, fontWeight: 700, background: '#fff', color: '#71856F', border: '1px solid #EBE7DA', borderRadius: 10, cursor: 'pointer' }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
