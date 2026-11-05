'use client'

import { useEffect, useState } from 'react'
import { getMotivosPerda } from '@/lib/leads'
import { gravacaoPerda } from '@/lib/status-lead'
import type { MotivoPerda } from '@/types/database'

interface Props {
  funnelId: string
  /** Texto abaixo do título (ex.: para onde o contato vai) */
  descricao?: string
  onCancelar: () => void
  /** Grava a perda; se lançar erro, a mensagem aparece no modal e ele continua aberto */
  onConfirmar: (motivoId: string, detalhe: string | null) => Promise<void>
}

/** Modal de motivo da perda (ficha e kanban): motivos ativos do funil, "Outro" exige texto. */
export default function MotivoPerdaModal({
  funnelId,
  descricao = 'O contato vai para a etapa de perda do funil. Se mandar mensagem, o negócio reabre. Spam, engano ou fornecedor? Use Arquivar.',
  onCancelar, onConfirmar,
}: Props) {
  const [motivos,  setMotivos]  = useState<MotivoPerda[] | null>(null)
  const [motivoId, setMotivoId] = useState('')
  const [detalhe,  setDetalhe]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [erro,     setErro]     = useState('')
  const motivoEscolhido = motivos?.find(m => m.id === motivoId) ?? null
  const validada = gravacaoPerda(motivoEscolhido, detalhe)

  useEffect(() => {
    let ativo = true
    getMotivosPerda(funnelId)
      .then(lista => { if (ativo) setMotivos(lista) })
      .catch(() => {
        if (!ativo) return
        setMotivos([])
        setErro('Não foi possível carregar os motivos de perda.')
      })
    return () => { ativo = false }
  }, [funnelId])

  async function confirmar() {
    if (!validada.ok || saving) return
    setSaving(true)
    setErro('')
    try {
      await onConfirmar(validada.valores.motivo_perda_id, validada.valores.motivo_perda)
    } catch (err) {
      setErro((err as { message?: string })?.message ?? 'Erro ao marcar como perdido.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(37,64,44,0.35)' }}>
      <div role="dialog" aria-labelledby="perda-titulo" style={{ background: '#fff', borderRadius: 18, boxShadow: '0 20px 60px -15px rgba(37,64,44,0.35)', width: '100%', maxWidth: 380, padding: 20 }}>
        <h3 id="perda-titulo" style={{ fontWeight: 800, color: '#25402C', fontSize: 16, margin: '0 0 2px' }}>Marcar negócio como perdido</h3>
        <p style={{ fontSize: 12, color: '#71856F', marginBottom: 16 }}>{descricao}</p>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#35543B', marginBottom: 8 }}>Motivo da perda *</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {motivos === null && <p style={{ fontSize: 12, color: '#9AA79C', margin: 0 }}>Carregando motivos...</p>}
          {motivos?.length === 0 && !erro && (
            <p style={{ fontSize: 12, color: '#C4534A', margin: 0 }}>Este funil não tem motivos de perda ativos. Peça a um gestor para configurar em Configurações › Funis.</p>
          )}
          {motivos?.map(m => (
            <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${motivoId === m.id ? '#C05B3A' : '#C9C3B2'}`, background: motivoId === m.id ? '#C05B3A' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
                {motivoId === m.id && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
              </div>
              <input type="radio" name="motivo-perda" value={m.id} checked={motivoId === m.id} onChange={() => setMotivoId(m.id)} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
              <span style={{ fontSize: 13, color: '#35543B' }}>{m.nome}</span>
            </label>
          ))}
        </div>
        {motivoEscolhido && (
          <textarea
            autoFocus={motivoEscolhido.nome === 'Outro'}
            value={detalhe}
            onChange={e => setDetalhe(e.target.value)}
            placeholder={motivoEscolhido.nome === 'Outro' ? 'Descreva o motivo *' : 'Detalhe (opcional)'}
            rows={2}
            style={{ width: '100%', borderRadius: 14, border: '1px solid #EBE7DA', padding: '8px 12px', fontSize: 13, outline: 'none', resize: 'none', marginBottom: 12, fontFamily: 'inherit', boxSizing: 'border-box', color: '#25402C' }}
          />
        )}
        {erro && <p style={{ fontSize: 12, color: '#C4534A', margin: '0 0 8px' }}>{erro}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onCancelar} disabled={saving} style={{ flex: 1, padding: '8px', fontSize: 13, border: '1px solid #EBE7DA', borderRadius: 12, background: 'transparent', cursor: 'pointer', color: '#71856F', transition: 'background 0.15s' }}>
            Cancelar
          </button>
          <button
            onClick={() => void confirmar()}
            disabled={!validada.ok || saving}
            title={validada.ok ? undefined : validada.erro}
            style={{ flex: 1, padding: '8px', fontSize: 13, background: '#C05B3A', color: '#fff', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700, opacity: (!validada.ok || saving) ? 0.5 : 1, transition: 'background 0.15s' }}
          >
            {saving ? 'Salvando...' : 'Marcar perdido'}
          </button>
        </div>
      </div>
    </div>
  )
}
