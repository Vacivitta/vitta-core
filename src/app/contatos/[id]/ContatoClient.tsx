'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { nomeDoContato, type NegocioDoContato } from '@/lib/contatos'
import { primeiraLetra } from '@/lib/texto'
import { CONTACT_ROLE_LABELS, STATUS_LEAD_LABELS, type ContactRole, type Contato } from '@/types/database'

export interface ConversaDoContato {
  id: string
  wa_phone: string
  status: string
  last_message_at: string | null
  last_message_content: string | null
}

interface Props {
  contato:     Contato
  responsavel: { id: string; nome: string; sobrenome: string | null } | null
  dependentes: Contato[]
  negocios:    NegocioDoContato[]
  conversas:   ConversaDoContato[]
}

type Aba = 'Negócios' | 'Dependentes' | 'Conversas'

const COR = { tinta: '#25402C', fraco: '#9AA79C', medio: '#71856F', borda: '#EBE7DA', verde: '#3E9849', fundo: '#FBFAF4' }
const cartao: React.CSSProperties = { background: '#fff', border: `1px solid ${COR.borda}`, borderRadius: 16, padding: 16 }
const selo: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, padding: '3px 10px', borderRadius: 999 }

const data = (s: string) => format(new Date(s), "d 'de' MMM 'de' yyyy", { locale: ptBR })
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const ehRelacao = (r: string | null): r is ContactRole => !!r && r in CONTACT_ROLE_LABELS

export default function ContatoClient({ contato, responsavel, dependentes, negocios, conversas }: Props) {
  const [aba, setAba] = useState<Aba>('Negócios')
  const nome = nomeDoContato(contato) ?? ''
  const contagem: Record<Aba, number> = { 'Negócios': negocios.length, 'Dependentes': dependentes.length, 'Conversas': conversas.length }
  const dados: [string, string | null][] = [
    ['Telefone', contato.telefone],
    ['E-mail', contato.email],
    ['CPF', contato.cpf],
    ['Nascimento', contato.data_nascimento ? data(`${contato.data_nascimento}T12:00:00`) : null],
    ['Profissão', contato.profissao],
    ['Cidade', [contato.cidade, contato.estado].filter(Boolean).join(' · ') || null],
    ['Instagram', contato.instagram],
    ['Site', contato.site],
  ]

  return (
    <div style={{ minHeight: '100%', background: COR.fundo, padding: '24px 16px 48px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ ...cartao, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ width: 60, height: 60, borderRadius: 999, background: '#D6EBD2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 21, fontWeight: 900, color: '#35853F' }}>{primeiraLetra(contato.nome)}{primeiraLetra(contato.sobrenome)}</span>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: '1px', color: COR.fraco, textTransform: 'uppercase' }}>Contato</p>
            <h1 style={{ margin: '2px 0 6px', fontSize: 21, fontWeight: 900, color: COR.tinta }}>{nome}</h1>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {contato.cliente && <span style={{ ...selo, background: '#FFF7E0', color: '#9A6B00' }}>Cliente</span>}
              {contato.wa_optout_at && <span style={{ ...selo, background: '#FDF1F2', color: '#C4534A' }}>Não quer WhatsApp</span>}
              {responsavel && (
                <Link href={`/contatos/${responsavel.id}`} style={{ ...selo, background: '#E8F4E6', color: COR.tinta, textDecoration: 'none' }}>
                  {ehRelacao(contato.relacao) ? CONTACT_ROLE_LABELS[contato.relacao] : 'Dependente'} de {nomeDoContato(responsavel)}
                </Link>
              )}
            </div>
          </div>
        </div>

        <div style={{ ...cartao, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px 20px' }}>
          {dados.map(([rotulo, valor]) => (
            <div key={rotulo} style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 10.5, fontWeight: 800, color: COR.fraco, textTransform: 'uppercase', letterSpacing: '.6px' }}>{rotulo}</p>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: valor ? COR.tinta : COR.fraco, overflowWrap: 'anywhere' }}>{valor || '—'}</p>
            </div>
          ))}
          {contato.observacoes && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={{ margin: 0, fontSize: 10.5, fontWeight: 800, color: COR.fraco, textTransform: 'uppercase', letterSpacing: '.6px' }}>Observações</p>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: COR.tinta, whiteSpace: 'pre-wrap' }}>{contato.observacoes}</p>
            </div>
          )}
          <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 11.5, color: COR.fraco }}>
            Para alterar os dados da pessoa, abra um negócio dela: por enquanto a edição fica na ficha do negócio.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 6, borderBottom: `1px solid ${COR.borda}`, overflowX: 'auto' }}>
          {(['Negócios', 'Dependentes', 'Conversas'] as const).map(a => (
            <button key={a} onClick={() => setAba(a)} style={{
              padding: '9px 14px', fontSize: 13, fontWeight: 800, background: 'none', border: 'none', cursor: 'pointer',
              color: aba === a ? COR.tinta : COR.fraco, borderBottom: `2px solid ${aba === a ? COR.verde : 'transparent'}`, whiteSpace: 'nowrap',
            }}>
              {a} <span style={{ color: COR.fraco, fontWeight: 700 }}>({contagem[a]})</span>
            </button>
          ))}
        </div>

        {aba === 'Negócios' && (
          <Lista vazia="Nenhum negócio deste contato.">
            {negocios.map(n => (
              <Link key={n.id} href={`/funil?lead=${n.id}`} style={{ ...cartao, display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: COR.tinta }}>{n.funil ?? 'Funil'}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11.5, color: COR.medio }}>
                    Aberto em {data(n.created_at)}{n.responsavel ? ` · ${n.responsavel}` : ''}
                  </p>
                </div>
                {n.valor !== null && <span style={{ fontSize: 13, fontWeight: 800, color: COR.tinta }}>{moeda(n.valor)}</span>}
                {n.etapa && n.status === 'aberto' && (
                  <span style={{ ...selo, background: (n.cor ?? COR.verde) + '18', color: n.cor ?? COR.verde }}>{n.etapa}</span>
                )}
                {n.status !== 'aberto' && (
                  <span style={{ ...selo, background: n.status === 'perdido' ? '#FDF1F2' : COR.tinta, color: n.status === 'perdido' ? '#C4534A' : '#fff' }}>
                    {STATUS_LEAD_LABELS[n.status]}
                  </span>
                )}
                {n.arquivado && <span style={{ ...selo, background: '#F1EFE8', color: COR.medio }}>Arquivado</span>}
              </Link>
            ))}
          </Lista>
        )}

        {aba === 'Dependentes' && (
          <Lista vazia="Nenhum dependente.">
            {dependentes.map(d => (
              <Link key={d.id} href={`/contatos/${d.id}`} style={{ ...cartao, display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none' }}>
                <div style={{ width: 32, height: 32, borderRadius: 999, background: '#E8F4E6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: COR.tinta }}>{primeiraLetra(d.nome)}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: COR.tinta }}>{nomeDoContato(d)}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11.5, color: COR.medio }}>
                    {ehRelacao(d.relacao) ? CONTACT_ROLE_LABELS[d.relacao] : 'Dependente'}
                    {d.data_nascimento ? ` · nasceu em ${data(`${d.data_nascimento}T12:00:00`)}` : ''}
                  </p>
                </div>
              </Link>
            ))}
          </Lista>
        )}

        {aba === 'Conversas' && (
          <Lista vazia="Nenhuma conversa ligada a este contato.">
            {conversas.map(c => (
              <Link key={c.id} href={`/atendimento?conversa=${c.id}`} style={{ ...cartao, display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: COR.tinta }}>{c.wa_phone}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11.5, color: COR.medio, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.last_message_content ?? 'Sem mensagens'}
                  </p>
                </div>
                {c.last_message_at && <span style={{ fontSize: 11, color: COR.fraco, flexShrink: 0 }}>{data(c.last_message_at)}</span>}
              </Link>
            ))}
          </Lista>
        )}
      </div>
    </div>
  )
}

function Lista({ vazia, children }: { vazia: string; children: React.ReactNode[] }) {
  if (children.length === 0) return <p style={{ margin: 0, fontSize: 13, color: COR.fraco, padding: '8px 2px' }}>{vazia}</p>
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
}
