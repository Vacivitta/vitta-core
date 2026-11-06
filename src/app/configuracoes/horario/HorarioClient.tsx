'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  DIAS_NA_TELA, FUSOS_BRASIL, NOMES_DIAS, linhasDaSemana, problemasDaSemana, semanaDasLinhas,
  type LinhaFaixa, type Semana,
} from '@/lib/horario'

export interface HorarioComFaixas {
  id:        string
  escopo:    'unidade' | 'fila' | 'funil'
  fila_id:   string | null
  funnel_id: string | null
  ativo:     boolean
  horario_faixas: LinhaFaixa[]
}

export interface Feriado {
  id:      string
  unit_id: string | null
  data:    string
  nome:    string
  fechado: boolean
  inicio:  string | null
  fim:     string | null
}

type Alvo = { escopo: 'unidade' } | { escopo: 'fila'; fila_id: string } | { escopo: 'funil'; funnel_id: string }

interface Props {
  unidade:  { id: string; nome: string; fuso: string }
  /** Admin da marca: muda o fuso e os feriados nacionais. */
  marca:    boolean
  horarios: HorarioComFaixas[]
  filas:    { id: string; nome: string }[]
  funis:    { id: string; nome: string }[]
  feriados: Feriado[]
}

const COR = { tinta: '#25402C', fraco: '#9AA79C', medio: '#71856F', borda: '#EBE7DA', verde: '#3E9849', erro: '#DC2626' }
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${COR.borda}`, borderRadius: 12, padding: '18px 20px', marginBottom: 16 }
const titulo: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: COR.tinta, margin: 0 }
const sub: React.CSSProperties = { fontSize: 12, color: COR.fraco, margin: '3px 0 0' }
const entrada: React.CSSProperties = { padding: '6px 8px', fontSize: 12.5, border: `1px solid ${COR.borda}`, borderRadius: 7, color: COR.tinta, background: '#fff' }
const botao: React.CSSProperties = { padding: '7px 14px', fontSize: 12.5, fontWeight: 700, border: 'none', borderRadius: 8, background: COR.verde, color: '#fff', cursor: 'pointer' }
const botaoLeve: React.CSSProperties = { padding: '5px 10px', fontSize: 12, fontWeight: 600, border: `1px solid ${COR.borda}`, borderRadius: 8, background: '#fff', color: COR.medio, cursor: 'pointer' }

const dataBR = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })

export default function HorarioClient({ unidade, marca, horarios, filas, funis, feriados }: Props) {
  const supabase = createClient()
  const router   = useRouter()
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const daUnidade = horarios.find(h => h.escopo === 'unidade') ?? null
  const excecoes  = horarios.filter(h => h.escopo !== 'unidade')
  const nomeDoAlvo = (h: HorarioComFaixas) => h.escopo === 'fila'
    ? `Fila ${filas.find(f => f.id === h.fila_id)?.nome ?? '(inativa)'}`
    : `Funil ${funis.find(f => f.id === h.funnel_id)?.nome ?? '(inativo)'}`

  async function executar(acao: () => Promise<string | null>) {
    setSalvando(true)
    setErro(null)
    const falha = await acao()
    setSalvando(false)
    if (falha) setErro(falha)
    else router.refresh()
  }

  /** Grava as faixas novas antes de apagar as antigas: se a gravação falhar, nada se perde. */
  function salvarHorario(alvo: Alvo, existente: HorarioComFaixas | null, semana: Semana) {
    return executar(async () => {
      let horarioId = existente?.id
      if (!horarioId) {
        const { data, error } = await supabase.from('horarios_atendimento')
          .insert({ unit_id: unidade.id, ...alvo }).select('id').single()
        if (error) return `Não foi possível criar o horário: ${error.message}`
        horarioId = data.id as string
      }
      const { data: antigas, error: erroLeitura } = await supabase.from('horario_faixas').select('id').eq('horario_id', horarioId)
      if (erroLeitura) return `Não foi possível ler as faixas atuais: ${erroLeitura.message}`
      const novas = linhasDaSemana(semana).map(l => ({ ...l, horario_id: horarioId }))
      if (novas.length > 0) {
        const { error } = await supabase.from('horario_faixas').insert(novas)
        if (error) return `Não foi possível salvar as faixas: ${error.message}`
      }
      const idsAntigos = (antigas ?? []).map(a => a.id as string)
      if (idsAntigos.length > 0) {
        const { error } = await supabase.from('horario_faixas').delete().in('id', idsAntigos)
        if (error) return `As faixas novas foram salvas, mas as antigas não saíram: ${error.message}`
      }
      return null
    })
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 780, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: COR.tinta, margin: 0 }}>Horário de atendimento</h1>
        <p style={{ fontSize: 13, color: COR.fraco, margin: '4px 0 0', lineHeight: 1.5 }}>
          Dias, horas e feriados em que <strong style={{ color: COR.tinta }}>{unidade.nome}</strong>{' '}atende. Os fluxos usam
          para &quot;dentro do horário&quot;, &quot;esperar o horário abrir&quot; e SLA em horas de atendimento.
          Sem horário configurado, a unidade conta como sempre aberta.
        </p>
      </div>

      {erro && (
        <div role="alert" style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 9, marginBottom: 16, fontSize: 12.5, color: COR.erro }}>
          {erro}
        </div>
      )}

      <Fuso unidade={unidade} marca={marca} salvando={salvando}
        onSalvar={fuso => executar(async () => {
          const { data, error } = await supabase.from('units').update({ fuso }).eq('id', unidade.id).select('id')
          if (error) return `Não foi possível mudar o fuso: ${error.message}`
          return data?.length ? null : 'Só o admin da marca muda o fuso da unidade.'
        })} />

      <div style={card}>
        <p style={titulo}>Horário da unidade</p>
        <p style={sub}>Vale para todas as conversas e funis que não têm exceção. O fim não está incluído: 8:00–12:00 fecha às 12:00.</p>
        <EditorSemana key={daUnidade?.id ?? 'novo'} inicial={semanaDasLinhas(daUnidade?.horario_faixas ?? [])} salvando={salvando}
          onSalvar={semana => salvarHorario({ escopo: 'unidade' }, daUnidade, semana)} />
      </div>

      <div style={card}>
        <p style={titulo}>Exceções por fila ou funil</p>
        <p style={sub}>Uma fila ou um funil com horário próprio (ex.: o comercial até 21h). A fila vence o funil, que vence a unidade.</p>
        {excecoes.map(h => (
          <div key={h.id} style={{ borderTop: `1px solid ${COR.borda}`, marginTop: 14, paddingTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: COR.tinta, margin: 0 }}>{nomeDoAlvo(h)}</p>
              <button style={botaoLeve} disabled={salvando}
                onClick={() => executar(async () => {
                  const { error } = await supabase.from('horarios_atendimento').delete().eq('id', h.id)
                  return error ? `Não foi possível remover a exceção: ${error.message}` : null
                })}>Remover exceção</button>
            </div>
            <EditorSemana inicial={semanaDasLinhas(h.horario_faixas)} salvando={salvando}
              onSalvar={semana => salvarHorario(h.escopo === 'fila' ? { escopo: 'fila', fila_id: h.fila_id! } : { escopo: 'funil', funnel_id: h.funnel_id! }, h, semana)} />
          </div>
        ))}
        <NovaExcecao filas={filas.filter(f => !excecoes.some(h => h.fila_id === f.id))}
          funis={funis.filter(f => !excecoes.some(h => h.funnel_id === f.id))} salvando={salvando}
          onCriar={alvo => salvarHorario(alvo, null, semanaDasLinhas(daUnidade?.horario_faixas ?? []))} />
      </div>

      <Feriados unidade={unidade} marca={marca} feriados={feriados} salvando={salvando}
        onCriar={f => executar(async () => {
          const { error } = await supabase.from('feriados').insert(f)
          if (error?.code === '23505') return 'Já existe um feriado nesta data.'
          return error ? `Não foi possível criar o feriado: ${error.message}` : null
        })}
        onRemover={id => executar(async () => {
          const { error } = await supabase.from('feriados').delete().eq('id', id)
          return error ? `Não foi possível remover o feriado: ${error.message}` : null
        })} />
    </div>
  )
}

function Fuso({ unidade, marca, salvando, onSalvar }: {
  unidade: Props['unidade']; marca: boolean; salvando: boolean; onSalvar: (fuso: string) => void
}) {
  const [fuso, setFuso] = useState(unidade.fuso)
  const conhecido = FUSOS_BRASIL.find(f => f.id === unidade.fuso)
  return (
    <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <p style={titulo}>Fuso horário</p>
        <p style={sub}>{marca ? 'Definido pela marca para cada unidade.' : 'Definido pela marca. Fale com a marca para mudar.'}</p>
      </div>
      {marca ? (
        <>
          <select value={fuso} onChange={e => setFuso(e.target.value)} style={entrada} aria-label="Fuso horário da unidade">
            {!conhecido && <option value={unidade.fuso}>{unidade.fuso}</option>}
            {FUSOS_BRASIL.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
          <button style={botao} disabled={salvando || fuso === unidade.fuso} onClick={() => onSalvar(fuso)}>Salvar fuso</button>
        </>
      ) : (
        <span style={{ fontSize: 13, fontWeight: 700, color: COR.tinta }}>{conhecido?.nome ?? unidade.fuso}</span>
      )}
    </div>
  )
}

function EditorSemana({ inicial, salvando, onSalvar }: { inicial: Semana; salvando: boolean; onSalvar: (s: Semana) => void }) {
  const [semana, setSemana] = useState<Semana>(inicial)
  const problemas = problemasDaSemana(semana)
  const alterada = JSON.stringify(semana) !== JSON.stringify(inicial)

  const mudarDia = (dia: number, faixas: Semana[number]) => setSemana(s => s.map((f, i) => i === dia ? faixas : f))

  return (
    <div style={{ marginTop: 12 }}>
      {DIAS_NA_TELA.map(dia => (
        <div key={dia} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F6F4EC', flexWrap: 'wrap' }}>
          <span style={{ width: 70, fontSize: 12.5, fontWeight: 700, color: COR.tinta }}>{NOMES_DIAS[dia]}</span>
          {semana[dia].length === 0 && <span style={{ fontSize: 12, color: COR.fraco }}>Fechado</span>}
          {semana[dia].map((f, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="time" value={f.inicio} aria-label={`${NOMES_DIAS[dia]}: início da faixa ${i + 1}`} style={entrada}
                onChange={e => mudarDia(dia, semana[dia].map((x, j) => j === i ? { ...x, inicio: e.target.value } : x))} />
              <span style={{ color: COR.fraco }}>–</span>
              <input type="time" value={f.fim} aria-label={`${NOMES_DIAS[dia]}: fim da faixa ${i + 1}`} style={entrada}
                onChange={e => mudarDia(dia, semana[dia].map((x, j) => j === i ? { ...x, fim: e.target.value } : x))} />
              <button aria-label={`Remover faixa ${i + 1} de ${NOMES_DIAS[dia]}`} style={{ ...botaoLeve, padding: '3px 8px' }}
                onClick={() => mudarDia(dia, semana[dia].filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          <button style={{ ...botaoLeve, padding: '3px 8px' }}
            onClick={() => mudarDia(dia, [...semana[dia], semana[dia].length ? { inicio: '13:00', fim: '18:00' } : { inicio: '08:00', fim: '12:00' }])}>
            + faixa
          </button>
        </div>
      ))}
      {problemas.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: COR.erro }}>
          {problemas.map(p => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button style={botao} disabled={salvando || !alterada || problemas.length > 0} onClick={() => onSalvar(semana)}>Salvar horário</button>
        {alterada && <button style={botaoLeve} onClick={() => setSemana(inicial)}>Desfazer</button>}
      </div>
    </div>
  )
}

function NovaExcecao({ filas, funis, salvando, onCriar }: {
  filas: { id: string; nome: string }[]; funis: { id: string; nome: string }[]; salvando: boolean; onCriar: (a: Alvo) => void
}) {
  const [escolha, setEscolha] = useState('')
  if (filas.length === 0 && funis.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, borderTop: `1px solid ${COR.borda}`, paddingTop: 14 }}>
      <select value={escolha} onChange={e => setEscolha(e.target.value)} style={{ ...entrada, flex: 1 }} aria-label="Fila ou funil da nova exceção">
        <option value="">Escolha uma fila ou um funil…</option>
        {filas.length > 0 && <optgroup label="Filas">{filas.map(f => <option key={f.id} value={`fila:${f.id}`}>{f.nome}</option>)}</optgroup>}
        {funis.length > 0 && <optgroup label="Funis">{funis.map(f => <option key={f.id} value={`funil:${f.id}`}>{f.nome}</option>)}</optgroup>}
      </select>
      <button style={botao} disabled={salvando || !escolha}
        onClick={() => {
          const [tipo, id] = escolha.split(':')
          onCriar(tipo === 'fila' ? { escopo: 'fila', fila_id: id } : { escopo: 'funil', funnel_id: id })
          setEscolha('')
        }}>
        Criar exceção
      </button>
    </div>
  )
}

function Feriados({ unidade, marca, feriados, salvando, onCriar, onRemover }: {
  unidade: Props['unidade']; marca: boolean; feriados: Feriado[]; salvando: boolean
  onCriar: (f: Omit<Feriado, 'id'>) => void; onRemover: (id: string) => void
}) {
  const [data, setData] = useState('')
  const [nome, setNome] = useState('')
  const [especial, setEspecial] = useState(false)
  const [inicio, setInicio] = useState('09:00')
  const [fim, setFim] = useState('12:00')
  const [nacional, setNacional] = useState(false)
  const invalido = !data || !nome.trim() || (especial && (!inicio || !fim || fim <= inicio))
  const daUnidade = new Set(feriados.filter(f => f.unit_id).map(f => f.data))

  return (
    <div style={card}>
      <p style={titulo}>Feriados</p>
      <p style={sub}>
        Os nacionais vêm da marca. A unidade acrescenta os seus e pode abrir num feriado nacional com horário especial.
        Valem para a unidade inteira, inclusive filas e funis com exceção.
      </p>
      <div style={{ marginTop: 12 }}>
        {feriados.length === 0 && <p style={{ fontSize: 12, color: COR.fraco }}>Nenhum feriado daqui para a frente.</p>}
        {feriados.map(f => {
          const encoberto = !f.unit_id && daUnidade.has(f.data)
          return (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #F6F4EC', opacity: encoberto ? 0.5 : 1 }}>
              <span style={{ width: 140, fontSize: 12.5, color: COR.tinta }}>{dataBR(f.data)}</span>
              <span style={{ flex: 1, fontSize: 12.5, color: COR.tinta }}>
                {f.nome}
                <span style={{ marginLeft: 8, fontSize: 11, color: COR.fraco }}>
                  {f.unit_id ? unidade.nome : 'Nacional (marca)'} · {f.fechado ? 'fechado' : `${f.inicio?.slice(0, 5)}–${f.fim?.slice(0, 5)}`}
                  {encoberto ? ' · substituído pelo da unidade' : ''}
                </span>
              </span>
              {!f.unit_id && !encoberto && (
                <button style={botaoLeve} onClick={() => { setData(f.data); setNome(f.nome); setEspecial(true); setNacional(false) }}>
                  Abrir com horário especial
                </button>
              )}
              {(f.unit_id || marca) && (
                <button style={botaoLeve} disabled={salvando} onClick={() => onRemover(f.id)}>Remover</button>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
        <input type="date" value={data} onChange={e => setData(e.target.value)} style={entrada} aria-label="Data do feriado" />
        <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome (ex.: Aniversário da cidade)" style={{ ...entrada, flex: 1, minWidth: 180 }} />
        <label style={{ fontSize: 12, color: COR.medio, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={especial} onChange={e => setEspecial(e.target.checked)} /> Horário especial
        </label>
        {especial && (
          <>
            <input type="time" value={inicio} onChange={e => setInicio(e.target.value)} style={entrada} aria-label="Início do horário especial" />
            <input type="time" value={fim} onChange={e => setFim(e.target.value)} style={entrada} aria-label="Fim do horário especial" />
          </>
        )}
        {marca && (
          <label style={{ fontSize: 12, color: COR.medio, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={nacional} onChange={e => setNacional(e.target.checked)} /> Nacional (todas as unidades)
          </label>
        )}
        <button style={botao} disabled={salvando || invalido}
          onClick={() => {
            onCriar({
              unit_id: nacional ? null : unidade.id, data, nome: nome.trim(), fechado: !especial,
              inicio: especial ? inicio : null, fim: especial ? fim : null,
            })
            setData(''); setNome(''); setEspecial(false); setNacional(false)
          }}>
          Adicionar feriado
        </button>
      </div>
    </div>
  )
}
