'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/context/ProfileContext'
import { enviarOrcamentoWhatsapp } from '@/lib/orcamento/enviar-whatsapp'
import QuoteModal, { type PatientOption, type QuoteRow } from './QuoteModal'
import type { Product, QuoteTemplate, UnitPaymentFees } from '@/types/database'

interface Props {
  /** Cliente do orçamento (já selecionado no formulário) */
  leadId:   string
  onClose:  () => void
  /** Chamado após salvar (ex.: atualizar a lista de orçamentos do lead) */
  onSaved?: (q: QuoteRow) => void
}

interface Dados {
  lead:        PatientOption & { unit_id: string }
  products:    Product[]
  templates:   QuoteTemplate[]
  paymentFees: UnitPaymentFees | null
}

/**
 * Formulário de orçamento aberto direto no Funil e no Atendimento, sem ir para a
 * tela de Orçamentos. Carrega os dados da unidade do cliente (produtos, modelos,
 * taxas) e reaproveita o mesmo formulário da tela de Orçamentos. Depois de salvar,
 * oferece enviar o PDF no WhatsApp do cliente.
 */
export default function NovoOrcamentoRapido({ leadId, onClose, onSaved }: Props) {
  const { profile } = useProfile()
  const [dados,     setDados]     = useState<Dados | null>(null)
  const [erro,      setErro]      = useState('')
  const [salvo,     setSalvo]     = useState<QuoteRow | null>(null)
  const [enviando,  setEnviando]  = useState(false)
  const [enviado,   setEnviado]   = useState(false)
  const [erroEnvio, setErroEnvio] = useState('')

  useEffect(() => {
    const supabase = createClient()
    let cancelado = false
    void (async () => {
      const { data: lead } = await supabase
        .from('leads').select('id, nome, sobrenome, telefone, unit_id').eq('id', leadId).single()
      if (!lead) { if (!cancelado) setErro('Cliente não encontrado.'); return }
      const [{ data: products }, { data: templates }, { data: fees }] = await Promise.all([
        supabase.from('products').select('*').eq('ativo', true).eq('unit_id', lead.unit_id).order('nome'),
        supabase.from('quote_templates').select('*').eq('ativo', true).eq('unit_id', lead.unit_id).order('nome'),
        supabase.from('unit_payment_fees').select('*').eq('unit_id', lead.unit_id).maybeSingle(),
      ])
      if (cancelado) return
      setDados({
        lead:        lead as Dados['lead'],
        products:    (products ?? []) as Product[],
        templates:   (templates ?? []) as QuoteTemplate[],
        paymentFees: (fees as UnitPaymentFees) ?? null,
      })
    })()
    return () => { cancelado = true }
  }, [leadId])

  async function enviar() {
    if (!salvo) return
    setEnviando(true); setErroEnvio('')
    try {
      await enviarOrcamentoWhatsapp(salvo.id)
      setEnviado(true)
    } catch (e) {
      setErroEnvio(e instanceof Error ? e.message : 'Erro ao enviar o orçamento.')
    } finally {
      setEnviando(false)
    }
  }

  if (erro) {
    return emCamada(<Aviso onClose={onClose}><p className="text-sm text-red-600">{erro}</p></Aviso>)
  }

  if (salvo) {
    const numero = String(salvo.numero ?? 0).padStart(4, '0')
    return emCamada(
      <Aviso onClose={onClose}>
        <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl border border-green-200">
          <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-green-800 font-medium">Orçamento nº {numero} criado!</p>
        </div>
        {enviado ? (
          <p className="text-sm text-gray-600">PDF enviado no WhatsApp do cliente.</p>
        ) : (
          <button
            onClick={enviar}
            disabled={enviando}
            className="w-full py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-60 transition-colors"
            style={{ background: '#25D366' }}
          >
            {enviando ? 'Gerando e enviando o PDF...' : 'Enviar PDF no WhatsApp'}
          </button>
        )}
        {erroEnvio && <p className="text-xs text-red-600">{erroEnvio}</p>}
        <button onClick={onClose} className="w-full py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
          {enviado ? 'Concluir' : 'Fechar sem enviar'}
        </button>
      </Aviso>
    )
  }

  if (!dados || !profile) {
    return emCamada(<Aviso onClose={onClose}><p className="text-sm text-gray-500">Carregando...</p></Aviso>)
  }

  return emCamada(
    <QuoteModal
      editing={null}
      unitId={dados.lead.unit_id}
      userId={profile.id}
      products={dados.products}
      templates={dados.templates}
      leads={[dados.lead]}
      paymentFees={dados.paymentFees}
      initialPatient={dados.lead}
      onClose={onClose}
      onSaved={q => { setSalvo(q); onSaved?.(q) }}
    />
  )
}

/**
 * Renderiza no <body>, acima do painel do lead (z 50) e dos diálogos dele (z 60):
 * o painel do funil usa transform, e um elemento fixo dentro dele ficaria preso a ele.
 */
function emCamada(node: React.ReactNode) {
  return createPortal(<div style={{ position: 'relative', zIndex: 70 }}>{node}</div>, document.body)
}

/** Caixa centralizada usada para carregamento, erro e confirmação. */
function Aviso({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
