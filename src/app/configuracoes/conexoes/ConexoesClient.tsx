'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { podeCriarConexao, podeGerenciarConexao, type QuemPede } from '@/lib/conexoes'
import type { Conexao } from '@/types/database'


interface Props {
  unidade:             { id: string; nome: string }
  conexoes:            Conexao[]
  nomesDasDonas:       Record<string, string>
  quem:                QuemPede
  conectorConfigurado: boolean
}

const COR = { tinta: '#25402C', fraco: '#9AA79C', medio: '#71856F', borda: '#EBE7DA', verde: '#3E9849', erro: '#DC2626', aviso: '#92400E' }
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${COR.borda}`, borderRadius: 12, padding: '16px 18px', marginBottom: 12 }
const titulo: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: COR.tinta, margin: 0 }
const sub: React.CSSProperties = { fontSize: 12, color: COR.fraco, margin: '3px 0 0', lineHeight: 1.5 }
const entrada: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${COR.borda}`, borderRadius: 7, color: COR.tinta, background: '#fff', minWidth: 220 }
const botao: React.CSSProperties = { padding: '7px 14px', fontSize: 12.5, fontWeight: 700, border: 'none', borderRadius: 8, background: COR.verde, color: '#fff', cursor: 'pointer' }
const botaoLeve: React.CSSProperties = { padding: '6px 11px', fontSize: 12, fontWeight: 600, border: `1px solid ${COR.borda}`, borderRadius: 8, background: '#fff', color: COR.medio, cursor: 'pointer' }

const STATUS: Record<string, { texto: string; cor: string; fundo: string }> = {
  conectada:     { texto: 'Conectada',         cor: '#166534', fundo: '#DCFCE7' },
  aguardando_qr: { texto: 'Aguardando QR Code', cor: COR.aviso, fundo: '#FEF3C7' },
  desconectada:  { texto: 'Desconectada',      cor: '#991B1B', fundo: '#FEE2E2' },
}

export default function ConexoesClient({ unidade, conexoes, nomesDasDonas, quem, conectorConfigurado }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [lendoQr, setLendoQr] = useState<{ id: string; qr: string | null } | null>(null)
  const [nome, setNome] = useState('')
  const [pessoal, setPessoal] = useState(!quem.ehGestor)
  const [ocupado, setOcupado] = useState(false)

  const atualizar = () => startTransition(() => router.refresh())

  // Enquanto o QR está na tela, consulta a cada 3 s: novo QR (ele expira) ou conectada
  const idLendo = lendoQr?.id
  useEffect(() => {
    if (!idLendo) return
    let ativo = true
    const timer = setInterval(async () => {
      const res = await fetch(`/api/conexoes/${idLendo}`)
      const corpo = await res.json().catch(() => ({})) as { status?: string; qr?: string | null; error?: string }
      if (!ativo) return
      if (!res.ok) { setErro(corpo.error ?? 'Não foi possível consultar a conexão'); return }
      if (corpo.status === 'conectada') {
        setLendoQr(null)
        startTransition(() => router.refresh())
      } else if (corpo.qr) {
        setLendoQr(atual => (atual?.id === idLendo ? { id: idLendo, qr: corpo.qr ?? null } : atual))
      }
    }, 3000)
    return () => { ativo = false; clearInterval(timer) }
  }, [idLendo, router])

  async function criar(comoPessoal: boolean) {
    setErro(null)
    setOcupado(true)
    const res = await fetch('/api/conexoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit_id: unidade.id, nome: nome.trim(), pessoal: comoPessoal }),
    })
    const corpo = await res.json().catch(() => ({})) as { id?: string; qr?: string | null; error?: string }
    setOcupado(false)
    if (!res.ok || !corpo.id) { setErro(corpo.error ?? 'Não foi possível criar a conexão'); return }
    setNome('')
    setLendoQr({ id: corpo.id, qr: corpo.qr ?? null })
    atualizar()
  }

  async function mostrarQr(id: string) {
    setErro(null)
    setLendoQr({ id, qr: null })
    const res = await fetch(`/api/conexoes/${id}`)
    const corpo = await res.json().catch(() => ({})) as { status?: string; qr?: string | null; error?: string }
    if (!res.ok) { setErro(corpo.error ?? 'Não foi possível consultar a conexão'); setLendoQr(null); return }
    if (corpo.status === 'conectada') { setLendoQr(null); atualizar(); return }
    setLendoQr({ id, qr: corpo.qr ?? null })
  }

  async function remover(c: Conexao) {
    if (!confirm(`Desconectar e remover "${c.nome}"? O número sai do VittaDesk; as conversas já recebidas continuam no Atendimento.`)) return
    setErro(null)
    setOcupado(true)
    const res = await fetch(`/api/conexoes/${c.id}`, { method: 'DELETE' })
    const corpo = await res.json().catch(() => ({})) as { error?: string }
    setOcupado(false)
    if (!res.ok) { setErro(corpo.error ?? 'Não foi possível remover a conexão'); return }
    if (lendoQr?.id === c.id) setLendoQr(null)
    atualizar()
  }

  const ativas = conexoes.filter(c => c.ativo || c.tipo === 'oficial')
  const podePessoal = podeCriarConexao(quem, true)
  const podeDaUnidade = podeCriarConexao(quem, false)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 780, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: COR.tinta, margin: 0 }}>Conexões de WhatsApp</h1>
        <p style={{ fontSize: 13, color: COR.fraco, margin: '4px 0 0', lineHeight: 1.5 }}>
          Números de <strong style={{ color: COR.tinta }}>{unidade.nome}</strong>{' '}no Atendimento. Cada conversa responde pelo
          número em que chegou.
        </p>
      </div>

      {erro && (
        <div role="alert" style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 9, marginBottom: 16, fontSize: 12.5, color: COR.erro }}>
          {erro}
        </div>
      )}

      {ativas.map(c => {
        const st = STATUS[c.status] ?? STATUS.desconectada
        const gerencia = podeGerenciarConexao(quem, c)
        return (
          <div key={c.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <p style={titulo}>
                  {c.nome}
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, color: st.cor, background: st.fundo }}>{st.texto}</span>
                </p>
                <p style={sub}>
                  {c.numero ?? 'Número aparece ao conectar'}
                  {' · '}
                  {c.tipo === 'oficial' ? 'API oficial da Meta' : `QR Code · até ${c.limite_por_minuto} mensagens por minuto`}
                  {c.pessoal && c.dona_id && ` · pessoal de ${nomesDasDonas[c.dona_id] ?? 'outra pessoa'} (só ela e a marca veem as conversas)`}
                </p>
              </div>
              {c.tipo === 'oficial' && <span style={{ fontSize: 12, color: COR.fraco }}>Configurada em WhatsApp API</span>}
              {gerencia && c.status !== 'conectada' && lendoQr?.id !== c.id && (
                <button style={botao} disabled={ocupado} onClick={() => mostrarQr(c.id)}>Ler QR Code</button>
              )}
              {gerencia && (
                <button style={botaoLeve} disabled={ocupado} onClick={() => remover(c)}>Remover</button>
              )}
            </div>
            {lendoQr?.id === c.id && <QrCode qr={lendoQr.qr} onFechar={() => setLendoQr(null)} />}
          </div>
        )
      })}

      {(podePessoal || podeDaUnidade) && (
        <div style={card}>
          <p style={titulo}>Conectar um número por QR Code</p>
          <div role="note" style={{ margin: '10px 0 12px', padding: '10px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 9, fontSize: 12.5, color: COR.aviso, lineHeight: 1.5 }}>
            <strong>Canal não oficial.</strong>{' '}O WhatsApp pode bloquear o número. Use para conversas do dia a dia (como os grupos da CS);
            campanhas, disparos em massa e modelos de mensagem continuam só na API oficial. O envio é limitado por minuto.
          </div>
          {!conectorConfigurado ? (
            <p style={sub}>O conector de QR Code ainda não está ligado neste ambiente.</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <input style={entrada} value={nome} maxLength={60} placeholder="Nome (ex.: WhatsApp da CS)"
                aria-label="Nome da conexão" onChange={e => setNome(e.target.value)} />
              {podePessoal && podeDaUnidade ? (
                <label style={{ fontSize: 12.5, color: COR.medio, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={pessoal} onChange={e => setPessoal(e.target.checked)} />
                  Número pessoal (só eu e a marca vemos as conversas)
                </label>
              ) : (
                <span style={{ fontSize: 12, color: COR.fraco }}>{podePessoal ? 'Será o seu número pessoal.' : 'Número da unidade.'}</span>
              )}
              <button style={botao} disabled={ocupado || !nome.trim()}
                onClick={() => void criar(podePessoal && podeDaUnidade ? pessoal : podePessoal)}>
                {ocupado ? 'Criando…' : 'Gerar QR Code'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function QrCode({ qr, onFechar }: { qr: string | null; onFechar: () => void }) {
  return (
    <div style={{ marginTop: 14, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ width: 220, height: 220, border: `1px solid ${COR.borda}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
        {qr
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={qr} alt="QR Code para conectar o WhatsApp" width={208} height={208} />
          : <span style={{ fontSize: 12, color: COR.fraco }}>Gerando QR Code…</span>}
      </div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: COR.medio, lineHeight: 1.8 }}>
          <li>No celular, abra o WhatsApp.</li>
          <li>Toque em <strong>Dispositivos conectados</strong> › <strong>Conectar dispositivo</strong>.</li>
          <li>Aponte a câmera para este QR Code.</li>
        </ol>
        <p style={sub}>O QR Code muda a cada poucos segundos; a tela atualiza sozinha e fecha quando o número conectar.</p>
        <button style={{ ...botaoLeve, marginTop: 10 }} onClick={onFechar}>Fechar</button>
      </div>
    </div>
  )
}
