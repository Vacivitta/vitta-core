'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resumoErro } from '@/lib/log-seguro'
import { APP_ERROR_ORIGEM_LABELS, type AppError } from '@/types/database'

type Filtro = 'abertos' | 'resolvidos'

interface Props {
  currentUserId: string
  initialErros:  AppError[]
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function Pill({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: bg, color, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

export default function ErrosClient({ currentUserId, initialErros }: Props) {
  const supabase = createClient()
  const [erros, setErros]       = useState<AppError[]>(initialErros)
  const [filtro, setFiltro]     = useState<Filtro>('abertos')
  const [aberto, setAberto]     = useState<string | null>(null)
  const [salvando, setSalvando] = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)

  const visiveis = erros
    .filter(e => (filtro === 'abertos') === (e.resolvido_em === null))
    .sort((a, b) => b.ultimo_em.localeCompare(a.ultimo_em))
  const totalAbertos = erros.filter(e => e.resolvido_em === null).length

  async function marcarResolvido(id: string) {
    setSalvando(id)
    setError(null)
    const resolvido = { resolvido_em: new Date().toISOString(), resolvido_por: currentUserId }
    const { data, error: err } = await supabase
      .from('app_errors')
      .update(resolvido)
      .eq('id', id)
      .select('id')
    setSalvando(null)
    // Sem permissão o RLS não dá erro: só não atualiza nenhuma linha
    if (err || !data || data.length === 0) {
      setError(`Não foi possível marcar como resolvido${err ? `: ${resumoErro(err)}` : '.'}`)
      return
    }
    setErros(prev => prev.map(e => e.id === id ? { ...e, ...resolvido } : e))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #F1EFE5', padding: '18px 28px', flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#25402C', margin: 0, letterSpacing: '-0.02em' }}>Erros do servidor</h1>
        <p style={{ fontSize: 12, color: '#9AA79C', margin: '3px 0 0' }}>
          Erros não tratados em páginas, rotas de API, cron e webhook, agrupados quando se repetem. Ficam só no banco da VPS.
        </p>
      </header>

      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 28px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#DC2626' }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 6 }}>
            {(['abertos', 'resolvidos'] as const).map(f => (
              <button key={f} onClick={() => { setFiltro(f); setAberto(null) }} style={{
                padding: '7px 14px', fontSize: 12, fontWeight: 700, borderRadius: 9, border: 'none', cursor: 'pointer',
                background: filtro === f ? '#3E9849' : '#F1EFE5', color: filtro === f ? '#fff' : '#71856F',
              }}>
                {f === 'abertos' ? `Abertos (${totalAbertos})` : 'Resolvidos'}
              </button>
            ))}
          </div>

          {visiveis.length === 0 && (
            <div style={{ background: '#fff', border: '1px solid #F1EFE5', borderRadius: 12, padding: 28, textAlign: 'center', fontSize: 13, color: '#9AA79C' }}>
              {filtro === 'abertos' ? 'Nenhum erro em aberto.' : 'Nenhum erro resolvido nos últimos 30 dias.'}
            </div>
          )}

          {visiveis.map(e => {
            const expandido = aberto === e.id
            return (
              <div key={e.id} style={{
                background: '#fff', border: '1px solid #F1EFE5', borderRadius: 12,
                borderLeft: `3px solid ${e.resolvido_em ? '#D1D5DB' : '#DC2626'}`,
              }}>
                <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <button
                    onClick={() => setAberto(expandido ? null : e.id)}
                    style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                      <Pill bg="#FEE2E2" color="#991B1B">{e.tipo}</Pill>
                      <Pill bg="#F1EFE5" color="#25402C">{APP_ERROR_ORIGEM_LABELS[e.origem]}</Pill>
                      {e.rota && (
                        <span style={{ fontSize: 11, color: '#71856F', fontFamily: 'monospace' }}>
                          {e.metodo ? `${e.metodo} ` : ''}{e.rota}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#25402C', margin: 0, wordBreak: 'break-word' }}>{e.mensagem}</p>
                    <p style={{ fontSize: 11, color: '#9AA79C', margin: '6px 0 0' }}>
                      <strong style={{ color: '#25402C' }}>{e.ocorrencias}×</strong>
                      {' · '}primeiro em {dataHora(e.primeiro_em)}
                      {' · '}último em {dataHora(e.ultimo_em)}
                      {e.resolvido_em && <>{' · '}resolvido em {dataHora(e.resolvido_em)}</>}
                    </p>
                  </button>

                  {!e.resolvido_em && (
                    <button
                      onClick={() => marcarResolvido(e.id)}
                      disabled={salvando === e.id}
                      style={{
                        padding: '7px 12px', fontSize: 12, fontWeight: 700, borderRadius: 9, border: '1px solid #3E9849',
                        background: '#fff', color: '#3E9849', cursor: salvando === e.id ? 'wait' : 'pointer', flexShrink: 0,
                        opacity: salvando === e.id ? 0.6 : 1,
                      }}
                    >
                      {salvando === e.id ? 'Salvando…' : 'Marcar como resolvido'}
                    </button>
                  )}
                </div>

                {expandido && (
                  <div style={{ borderTop: '1px solid #F1EFE5', padding: '12px 16px' }}>
                    {e.digest && <p style={{ fontSize: 11, color: '#71856F', margin: '0 0 8px' }}>Digest: <code>{e.digest}</code></p>}
                    <pre style={{
                      margin: 0, fontSize: 11, lineHeight: 1.5, color: '#25402C', background: '#FAFAF7', borderRadius: 8,
                      padding: 12, overflowX: 'auto', whiteSpace: 'pre',
                    }}>
                      {e.stack ?? 'Sem stack registrada.'}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
