'use client'

import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import type { LeadAnexo } from '@/types/database'
import {
  ANEXO_ACCEPT, ANEXO_ERRO_TAMANHO, ANEXO_ERRO_TIPO, ANEXO_ERRO_VAZIO, ANEXO_TAMANHO_MAXIMO, formatarTamanho,
} from '@/lib/anexos'

const COLUNAS = 'id, lead_id, unit_id, nome, mime, tamanho, enviado_por, criado_em, autor:profiles!enviado_por(full_name)'
const EXTENSOES_ACEITAS = /\.(pdf|jpe?g|png|webp|heic|heif)$/i

/**
 * Lista de anexos do lead, lida pelo RLS do usuário. Fica no LeadModal (e não
 * dentro da aba) para o contador da aba aparecer antes de abri-la.
 */
export function useLeadAnexos(leadId: string) {
  const [anexos, setAnexos] = useState<LeadAnexo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    createClient()
      .from('lead_anexos')
      .select(COLUNAS)
      .eq('lead_id', leadId)
      .order('criado_em', { ascending: false })
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setErroLista('Não foi possível carregar os anexos.')
        else setAnexos((data ?? []) as unknown as LeadAnexo[])
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [leadId])

  return { anexos, setAnexos, carregando, erroLista }
}

type EstadoAnexos = ReturnType<typeof useLeadAnexos>

interface Props {
  leadId: string
  estado: EstadoAnexos
  currentUserId: string
  isGestor: boolean
}

interface Erro { nome: string; mensagem: string }

function erroLocal(arquivo: File): string | null {
  if (arquivo.size === 0) return ANEXO_ERRO_VAZIO
  if (arquivo.size > ANEXO_TAMANHO_MAXIMO) return ANEXO_ERRO_TAMANHO
  if (!EXTENSOES_ACEITAS.test(arquivo.name) && !ANEXO_ACCEPT.split(',').includes(arquivo.type)) return ANEXO_ERRO_TIPO
  return null
}

async function mensagemDaResposta(res: Response): Promise<string> {
  if (res.status === 413) return ANEXO_ERRO_TAMANHO
  const corpo = await res.json().catch(() => null) as { error?: string } | null
  return corpo?.error ?? 'Não foi possível enviar o arquivo. Tente de novo.'
}

export default function LeadAnexos({ leadId, estado, currentUserId, isGestor }: Props) {
  const { anexos, setAnexos, carregando, erroLista } = estado
  const inputRef = useRef<HTMLInputElement>(null)
  const [arrastando, setArrastando] = useState(false)
  const [enviando, setEnviando] = useState<string[]>([])
  const [erros, setErros] = useState<Erro[]>([])
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null)
  const [excluindoId, setExcluindoId] = useState<string | null>(null)

  async function enviar(arquivos: File[]) {
    setErros([])
    const novosErros: Erro[] = []
    for (const arquivo of arquivos) {
      const local = erroLocal(arquivo)
      if (local) { novosErros.push({ nome: arquivo.name, mensagem: local }); continue }
      setEnviando(prev => [...prev, arquivo.name])
      try {
        const form = new FormData()
        form.append('arquivo', arquivo)
        const res = await fetch(`/api/leads/${leadId}/anexos`, { method: 'POST', body: form })
        if (!res.ok) {
          novosErros.push({ nome: arquivo.name, mensagem: await mensagemDaResposta(res) })
        } else {
          const { anexo } = await res.json() as { anexo: LeadAnexo }
          setAnexos(prev => [anexo, ...prev])
        }
      } catch {
        novosErros.push({ nome: arquivo.name, mensagem: 'Sem conexão com o servidor. Tente de novo.' })
      } finally {
        setEnviando(prev => { const i = prev.indexOf(arquivo.name); return i < 0 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)] })
      }
    }
    setErros(novosErros)
  }

  async function excluir(anexo: LeadAnexo) {
    setExcluindoId(anexo.id)
    setErros([])
    try {
      const res = await fetch(`/api/leads/${leadId}/anexos/${anexo.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const corpo = await res.json().catch(() => null) as { error?: string } | null
        setErros([{ nome: anexo.nome, mensagem: corpo?.error ?? 'Não foi possível excluir o anexo.' }])
      } else {
        setAnexos(prev => prev.filter(a => a.id !== anexo.id))
      }
    } catch {
      setErros([{ nome: anexo.nome, mensagem: 'Sem conexão com o servidor. Tente de novo.' }])
    } finally {
      setExcluindoId(null)
      setConfirmandoId(null)
    }
  }

  function aoSoltar(e: React.DragEvent) {
    e.preventDefault()
    setArrastando(false)
    const arquivos = Array.from(e.dataTransfer.files)
    if (arquivos.length) void enviar(arquivos)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
        onDragOver={e => { e.preventDefault(); setArrastando(true) }}
        onDragLeave={() => setArrastando(false)}
        onDrop={aoSoltar}
        style={{
          background: arrastando ? '#F1F8EF' : '#fff', border: `2px dashed ${arrastando ? '#3E9849' : '#DCD7C7'}`,
          borderRadius: '14px', padding: '26px 22px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3E9849" strokeWidth="2" style={{ margin: '0 auto 8px' }}>
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
        <p style={{ fontSize: '13.5px', fontWeight: 700, color: '#25402C', margin: 0 }}>
          Arraste arquivos aqui ou clique para escolher
        </p>
        <p style={{ fontSize: '12px', color: '#9AA79C', margin: '4px 0 0' }}>
          PDF, JPG, PNG, WebP ou HEIC, até 20 MB cada. Carteira de vacinação, pedido médico, contrato, proposta.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ANEXO_ACCEPT}
          style={{ display: 'none' }}
          onChange={e => {
            const arquivos = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (arquivos.length) void enviar(arquivos)
          }}
        />
      </div>

      {enviando.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {enviando.map((nome, i) => (
            <p key={`${nome}-${i}`} style={{ fontSize: '12.5px', color: '#35543B', margin: 0 }}>Enviando {nome}…</p>
          ))}
        </div>
      )}

      {erros.length > 0 && (
        <div role="alert" style={{ background: '#FDF1F2', border: '1px solid #E8B4B0', borderRadius: '11px', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {erros.map((e, i) => (
            <p key={i} style={{ fontSize: '12.5px', color: '#C4534A', margin: 0 }}>
              <strong style={{ fontWeight: 700 }}>{e.nome}</strong>: {e.mensagem}
            </p>
          ))}
        </div>
      )}

      {carregando && <p style={{ fontSize: '13px', color: '#9AA79C', textAlign: 'center', padding: '24px 0' }}>Carregando…</p>}
      {erroLista && <p style={{ fontSize: '13px', color: '#C4534A', textAlign: 'center', padding: '24px 0' }}>{erroLista}</p>}
      {!carregando && !erroLista && anexos.length === 0 && (
        <p style={{ fontSize: '13px', color: '#9AA79C', textAlign: 'center', padding: '24px 0' }}>Nenhum anexo ainda</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {anexos.map(anexo => {
          const url = `/api/leads/${leadId}/anexos/${anexo.id}`
          const podeExcluir = isGestor || anexo.enviado_por === currentUserId
          const ePdf = anexo.mime === 'application/pdf'
          return (
            <div key={anexo.id} className="group" style={{ display: 'flex', alignItems: 'center', gap: '13px', background: '#fff', border: '1px solid #EBE7DA', borderRadius: '13px', padding: '13px 16px' }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: ePdf ? '#FDF1F2' : '#E8F4E6', color: ePdf ? '#C4534A' : '#35853F', fontSize: 10, fontWeight: 800 }}>
                {ePdf ? 'PDF' : 'IMG'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <a
                  href={`${url}?modo=abrir`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={anexo.nome}
                  style={{ display: 'block', fontSize: '13.5px', fontWeight: 700, color: '#25402C', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {anexo.nome}
                </a>
                <p style={{ fontSize: '12px', color: '#9AA79C', margin: '3px 0 0' }}>
                  {formatarTamanho(anexo.tamanho)}
                  {' · '}{anexo.autor?.full_name ?? 'Usuário removido'}
                  {' · '}{format(new Date(anexo.criado_em), 'dd/MM/yyyy HH:mm')}
                </p>
              </div>

              {confirmandoId === anexo.id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <span style={{ fontSize: '12px', color: '#35543B' }}>Excluir?</span>
                  <button
                    onClick={() => excluir(anexo)}
                    disabled={excluindoId === anexo.id}
                    style={{ fontSize: '11.5px', padding: '4px 10px', background: '#C4534A', color: '#fff', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: 700, opacity: excluindoId === anexo.id ? 0.6 : 1 }}
                  >
                    {excluindoId === anexo.id ? 'Excluindo…' : 'Excluir'}
                  </button>
                  <button
                    onClick={() => setConfirmandoId(null)}
                    disabled={excluindoId === anexo.id}
                    style={{ fontSize: '11.5px', padding: '4px 10px', background: 'transparent', color: '#35543B', border: '1px solid #EBE7DA', borderRadius: '7px', cursor: 'pointer' }}
                  >
                    Não
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  <a href={url} title="Baixar" aria-label={`Baixar ${anexo.nome}`} style={{ padding: 6, color: '#9AA79C', display: 'flex' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                  </a>
                  {podeExcluir && (
                    <button
                      onClick={() => setConfirmandoId(anexo.id)}
                      title="Excluir"
                      aria-label={`Excluir ${anexo.nome}`}
                      style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#9AA79C', display: 'flex' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#C4534A')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#9AA79C')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
