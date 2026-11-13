'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { nomeDoContato } from '@/lib/contatos'

interface Candidato {
  id: string
  nome: string
  sobrenome: string | null
  telefone: string | null
  email: string | null
  leads: { id: string }[]
}

const COR = { tinta: '#25402C', fraco: '#9AA79C', medio: '#71856F', borda: '#EBE7DA', verde: '#3E9849', erro: '#C4534A' }
const botao: React.CSSProperties = { padding: '7px 14px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, cursor: 'pointer' }

/**
 * Junta outra pessoa nesta ficha (mesclar_contatos, migração 153): os negócios,
 * dependentes, conversas e campos dela vêm para cá e a ficha dela some. Só gestor.
 */
export default function MesclarContato({ contatoId, unitId, nome }: { contatoId: string; unitId: string; nome: string }) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [candidatos, setCandidatos] = useState<Candidato[]>([])
  const [escolhido, setEscolhido] = useState<Candidato | null>(null)
  const [mesclando, setMesclando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    const termo = busca.trim()
    if (!aberto || termo.length < 2) return
    let vivo = true
    const digitos = termo.replace(/\D/g, '')
    const filtro = digitos.length >= 4
      ? `nome.ilike.%${termo}%,sobrenome.ilike.%${termo}%,telefone_norm.like.%${digitos}%`
      : `nome.ilike.%${termo}%,sobrenome.ilike.%${termo}%`
    const t = setTimeout(() => {
      void createClient().from('contatos')
        .select('id, nome, sobrenome, telefone, email, leads(id)')
        .eq('unit_id', unitId).is('responsavel_id', null).neq('id', contatoId)
        .or(filtro).order('nome').limit(8)
        .then(({ data }) => { if (vivo) setCandidatos((data ?? []) as Candidato[]) })
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [busca, aberto, unitId, contatoId])

  async function mesclar() {
    if (!escolhido) return
    setMesclando(true)
    setErro(null)
    const r = await fetch('/api/contatos/mesclar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manter: contatoId, remover: escolhido.id }),
    })
    setMesclando(false)
    if (!r.ok) {
      setErro((await r.json().catch(() => null) as { error?: string } | null)?.error ?? 'Não foi possível mesclar')
      return
    }
    // A ficha inteira muda (negócios, dependentes, conversas, dados): recarrega tudo
    window.location.reload()
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)}
        style={{ ...botao, border: `1px solid ${COR.borda}`, background: '#fff', color: COR.medio }}>
        Mesclar com outra pessoa
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      <label style={{ fontSize: 11.5, fontWeight: 700, color: COR.medio }}>
        Pessoa cadastrada duas vezes? Busque a outra ficha por nome ou telefone:
        <input autoFocus value={busca} onChange={e => { setBusca(e.target.value); setEscolhido(null) }} placeholder="Nome ou telefone"
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '7px 9px', fontSize: 13, border: `1px solid ${COR.borda}`, borderRadius: 8, color: COR.tinta }} />
      </label>
      {!escolhido && busca.trim().length >= 2 && (
        candidatos.length === 0
          ? <p style={{ margin: 0, fontSize: 12, color: COR.fraco }}>Ninguém encontrado nesta unidade.</p>
          : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {candidatos.map(c => (
                <li key={c.id}>
                  <button type="button" onClick={() => setEscolhido(c)}
                    style={{ width: '100%', textAlign: 'left', padding: '7px 10px', border: `1px solid ${COR.borda}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 12.5, color: COR.tinta }}>
                    <strong>{nomeDoContato(c)}</strong>
                    <span style={{ color: COR.medio }}>
                      {[c.telefone, c.email].filter(Boolean).map(v => ` · ${v}`).join('')} · {c.leads.length} negócio(s)
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
      )}
      {escolhido && (
        <div role="alertdialog" style={{ border: '1px solid #F2D9A8', background: '#FFF7E0', borderRadius: 10, padding: 12, fontSize: 12.5, color: COR.tinta, lineHeight: 1.5 }}>
          <strong>{nomeDoContato(escolhido)}</strong> será juntada a <strong>{nome}</strong>: os {escolhido.leads.length} negócio(s),
          os dependentes, as conversas e os campos dela passam para esta ficha, que completa o que não tem. Telefone e e-mail
          diferentes vão para as observações. A outra ficha some, e não dá para desfazer.
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={() => void mesclar()} disabled={mesclando}
              style={{ ...botao, border: 'none', background: '#C87F1B', color: '#fff', opacity: mesclando ? 0.6 : 1 }}>
              {mesclando ? 'Mesclando…' : 'Mesclar'}
            </button>
            <button type="button" onClick={() => setEscolhido(null)}
              style={{ ...botao, border: `1px solid ${COR.borda}`, background: '#fff', color: COR.medio }}>
              Escolher outra
            </button>
          </div>
        </div>
      )}
      {erro && <p role="alert" style={{ margin: 0, fontSize: 12, color: COR.erro }}>{erro}</p>}
      <button type="button" onClick={() => { setAberto(false); setEscolhido(null); setBusca(''); setErro(null) }}
        style={{ ...botao, alignSelf: 'flex-start', border: 'none', background: 'none', color: COR.fraco, padding: 0 }}>
        Fechar
      </button>
    </div>
  )
}
