'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { camposDoFunil } from '@/lib/campos'
import { decodificarArquivo, ehPlanilhaExcel, gerarCsv, lerCsv, pareceTextoCorrompido, type Codificacao } from '@/lib/csv'
import {
  COLUNAS_LEAD, MAX_BYTES_IMPORTACAO, MAX_LINHAS_IMPORTACAO, ROTULOS_COLUNA, chaveDoDestino, prepararImportacao,
  separarExistentes, sugerirMapeamento, validarMapeamento, type Destino, type RelatorioImportacao,
} from '@/lib/importacao'
import { telefonesExistentes } from '@/lib/importacao-banco'
import { campoFixo, rotuloObrigatorio } from '@/lib/obrigatorios'
import { ORIGEM_OPTIONS, type CampoLead, type TipoTag } from '@/types/database'

export interface FunilImportacao {
  id:     string
  nome:   string
  /** Só etapas sem resultado (ganho/perdido); exigidos = campos_obrigatorios (130) */
  etapas: { id: string; nome: string; exigidos: string[] }[]
}

interface Props {
  unitId:       string
  funis:        FunilImportacao[]
  responsaveis: { id: string; nome: string }[]
  campos:       CampoLead[]
  tags:         { id: string; name: string; tipo: TipoTag }[]
}

interface Arquivo {
  nome:        string
  texto:       string
  codificacao: Codificacao
  registros:   string[][]
}

interface Problema { linha: number; situacao: string; detalhe: string }

const MAX_PROBLEMAS_NA_TELA = 300

export default function ImportarClient({ unitId, funis, responsaveis, campos, tags }: Props) {
  const [arquivo, setArquivo]           = useState<Arquivo | null>(null)
  const [erroArquivo, setErroArquivo]   = useState('')
  const [mapeamento, setMapeamento]     = useState<Destino[]>([])
  const [funnelId, setFunnelId]         = useState(funis[0]?.id ?? '')
  const [stageId, setStageId]           = useState(funis[0]?.etapas[0]?.id ?? '')
  const [responsavelId, setResponsavel] = useState('')
  const [origemPadrao, setOrigemPadrao] = useState('')
  const [clientes, setClientes]         = useState(false)
  const [busca, setBusca]               = useState<{ chave: string; existentes: Set<string>; erro: string | null } | null>(null)
  const [enviando, setEnviando]         = useState(false)
  const [erroEnvio, setErroEnvio]       = useState('')
  const [relatorio, setRelatorio]       = useState<RelatorioImportacao | null>(null)

  const funil = funis.find(f => f.id === funnelId)
  const camposFunil = useMemo(() => camposDoFunil(campos, funnelId || null), [campos, funnelId])
  const erroMapa = arquivo ? validarMapeamento(mapeamento, camposFunil) : null
  const etapa = funil?.etapas.find(s => s.id === stageId)
  // Só o que o trigger da 130 confere: fixos e campos ativos deste funil
  const exigidos = useMemo(() => {
    const doDestino = funis.find(f => f.id === funnelId)?.etapas.find(s => s.id === stageId)?.exigidos ?? []
    return doDestino.filter(c => campoFixo(c) || camposFunil.some(d => d.chave === c))
  }, [funis, funnelId, stageId, camposFunil])

  const prep = useMemo(() => arquivo
    ? prepararImportacao(arquivo.registros, mapeamento, {
        campos: camposFunil, tags, origemPadrao: origemPadrao || null,
        funnelId, exigidos, responsavelId: responsavelId || null,
      })
    : null,
  [arquivo, mapeamento, camposFunil, tags, origemPadrao, funnelId, exigidos, responsavelId])

  const chaveTelefones = useMemo(() => (prep ? prep.linhas.map(l => l.telefoneNorm).join(',') : ''), [prep])
  useEffect(() => {
    if (!chaveTelefones) return
    let cancelado = false
    void telefonesExistentes(createClient(), unitId, chaveTelefones.split(',')).then(r => {
      if (!cancelado) setBusca({ chave: chaveTelefones, existentes: r.existentes, erro: r.erro })
    })
    return () => { cancelado = true }
  }, [chaveTelefones, unitId])
  const buscaAtual = busca?.chave === chaveTelefones ? busca : null
  const existentes = chaveTelefones === '' ? new Set<string>() : buscaAtual && !buscaAtual.erro ? buscaAtual.existentes : null
  const separacao = prep && existentes ? separarExistentes(prep.linhas, existentes) : null

  const problemas = useMemo<Problema[]>(() => {
    if (!prep) return []
    return [
      ...prep.invalidas.map(i => ({ linha: i.linha, situacao: 'Inválida', detalhe: i.motivo })),
      ...prep.repetidas.map(r => ({ linha: r.linha, situacao: 'Repetida no arquivo', detalhe: `${r.telefone} já está na linha ${r.primeiraLinha}` })),
      ...(separacao?.existentes ?? []).map(e => ({ linha: e.linha, situacao: 'Já existe', detalhe: `${e.telefone} já está cadastrado nesta unidade` })),
    ].sort((a, b) => a.linha - b.linha)
  }, [prep, separacao])

  async function escolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErroArquivo('')
    setRelatorio(null)
    setErroEnvio('')
    setArquivo(null)
    if (file.size > MAX_BYTES_IMPORTACAO) { setErroArquivo('Arquivo maior que 5 MB. Divida a planilha em partes.'); return }

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (ehPlanilhaExcel(bytes)) {
      setErroArquivo('Este é um arquivo do Excel (.xlsx/.xls). No Excel: Arquivo › Salvar como › "CSV UTF-8 (delimitado por vírgulas)" e escolha o arquivo .csv.')
      return
    }
    const { texto, codificacao } = decodificarArquivo(bytes)
    const { registros, aspasAbertas } = lerCsv(texto)
    if (aspasAbertas) { setErroArquivo('O arquivo tem aspas (") sem fechamento. Confira a planilha e salve de novo como CSV.'); return }
    if (registros.length < 2) { setErroArquivo('O arquivo precisa de um cabeçalho e pelo menos uma linha de contato.'); return }
    if (registros.length - 1 > MAX_LINHAS_IMPORTACAO) {
      setErroArquivo(`O arquivo tem ${registros.length - 1} linhas; o limite é ${MAX_LINHAS_IMPORTACAO.toLocaleString('pt-BR')}. Divida a planilha em partes.`)
      return
    }
    setArquivo({ nome: file.name, texto, codificacao, registros })
    setMapeamento(sugerirMapeamento(registros[0], camposFunil))
  }

  function trocarFunil(id: string) {
    setFunnelId(id)
    setStageId(funis.find(f => f.id === id)?.etapas[0]?.id ?? '')
    const validos = new Set(camposDoFunil(campos, id).map(c => c.chave))
    setMapeamento(m => m.map(d => {
      const chave = chaveDoDestino(d)
      return chave !== null && !validos.has(chave) ? 'ignorar' : d
    }))
  }

  async function importar() {
    if (!arquivo || !separacao) return
    const destino = `${funil?.nome ?? ''} › ${etapa?.nome ?? ''}`
    if (!window.confirm(`Importar ${separacao.novas.length} contato(s) para ${destino}?`)) return
    setEnviando(true)
    setErroEnvio('')
    try {
      const res = await fetch('/api/leads/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texto: arquivo.texto, mapeamento, funnel_id: funnelId, stage_id: stageId,
          responsavel_id: responsavelId || null, origem_padrao: origemPadrao || null, clientes,
        }),
      })
      const json = await res.json().catch(() => null) as (RelatorioImportacao & { error?: string }) | null
      if (json && typeof json.importados === 'number') setRelatorio(json)
      if (!res.ok) setErroEnvio(json?.error ?? 'Não foi possível importar. Tente de novo.')
    } catch {
      setErroEnvio('Sem resposta do servidor. Confira a conexão e reenvie: os contatos já importados serão pulados.')
    } finally {
      setEnviando(false)
    }
  }

  function baixarProblemas() {
    if (!arquivo || !relatorio) return
    const linhas: Problema[] = [
      ...relatorio.invalidas.map(i => ({ linha: i.linha, situacao: 'Inválida', detalhe: i.motivo })),
      ...relatorio.repetidas.map(r => ({ linha: r.linha, situacao: 'Repetida no arquivo', detalhe: `Mesmo telefone da linha ${r.primeiraLinha}` })),
      ...relatorio.existentes.map(e => ({ linha: e.linha, situacao: 'Já existe', detalhe: 'Telefone já cadastrado nesta unidade' })),
    ].sort((a, b) => a.linha - b.linha)
    const csv = gerarCsv([
      ['Linha', 'Situação', 'Motivo', ...arquivo.registros[0]],
      ...linhas.map(p => [String(p.linha), p.situacao, p.detalhe, ...(arquivo.registros[p.linha - 1] ?? [])]),
    ])
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `nao-importados-${arquivo.nome.replace(/\.[^.]+$/, '')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function recomecar() {
    setArquivo(null)
    setRelatorio(null)
    setErroEnvio('')
    setErroArquivo('')
  }

  const usados = new Set(mapeamento.filter(d => d !== 'ignorar'))
  const amostra = (col: number) => (arquivo?.registros.slice(1, 40).map(r => r[col]?.trim()).filter(Boolean) ?? []).slice(0, 2)
  const avisoCodificacao = arquivo?.codificacao === 'windows-1252'
    ? 'O arquivo não está em UTF-8 e foi lido como Windows-1252 (o "CSV" comum do Excel). Confira os acentos abaixo; se estiverem errados, salve como "CSV UTF-8".'
    : arquivo && pareceTextoCorrompido(arquivo.texto)
      ? 'Alguns acentos parecem corrompidos (ex.: "Ã£" no lugar de "ã"). A planilha pode ter sido salva com a codificação errada.'
      : null

  return (
    <div className="flex flex-col h-full" style={{ background: '#FBFAF4' }}>
      <div className="bg-white shrink-0" style={{ borderBottom: '1px solid #E9E5D8', padding: '16px 26px' }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 style={{ fontSize: '19px', fontWeight: 900, color: '#25402C', lineHeight: 1.3 }}>Importar contatos</h1>
            <p style={{ fontSize: '11.5px', fontWeight: 600, color: '#9AA79C', marginTop: '2px' }}>
              Planilha CSV com até {MAX_LINHAS_IMPORTACAO.toLocaleString('pt-BR')} linhas e 5 MB
            </p>
          </div>
          <Link href="/clientes" style={{ fontSize: 13, fontWeight: 700, color: '#3E9849' }}>Voltar para Clientes</Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: '20px 26px' }}>
        <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {relatorio ? (
            <Relatorio relatorio={relatorio} erro={erroEnvio} onBaixar={baixarProblemas} onRecomecar={recomecar} />
          ) : (
            <>
              <Cartao titulo="1. Arquivo">
                <label style={{ display: 'block', border: '2px dashed #EBE7DA', borderRadius: 12, padding: '18px 16px', textAlign: 'center', cursor: 'pointer', background: '#FBFAF4' }}>
                  <input type="file" accept=".csv,.txt,text/csv" onChange={e => void escolherArquivo(e)} style={{ display: 'none' }} />
                  <p style={{ fontSize: 13, fontWeight: 700, color: '#25402C', margin: '0 0 4px' }}>
                    {arquivo ? `${arquivo.nome} · ${arquivo.registros.length - 1} linha(s)` : 'Clique para escolher o arquivo CSV'}
                  </p>
                  <p style={{ fontSize: 11, color: '#9AA79C', margin: 0 }}>
                    Primeira linha com os nomes das colunas · separador ; ou , · no Excel: Arquivo › Salvar como › CSV UTF-8
                  </p>
                </label>
                <p style={{ fontSize: 11.5, color: '#71856F', margin: '10px 0 0' }}>
                  Nome e telefone são obrigatórios. Contato cujo telefone já existe nesta unidade é <strong>pulado</strong> (não é
                  atualizado) e aparece no relatório. Os contatos importados não recebem mensagem automática de WhatsApp.
                </p>
                {erroArquivo && <Alerta tipo="erro">{erroArquivo}</Alerta>}
                {avisoCodificacao && <Alerta tipo="aviso">{avisoCodificacao}</Alerta>}
              </Cartao>

              {arquivo && (
                <>
                  <Cartao titulo="2. Destino">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                      <Campo rotulo="Funil">
                        <select value={funnelId} onChange={e => trocarFunil(e.target.value)} style={selectSt}>
                          {funis.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                        </select>
                      </Campo>
                      <Campo rotulo="Etapa">
                        <select value={stageId} onChange={e => setStageId(e.target.value)} style={selectSt}>
                          {(funil?.etapas ?? []).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                        </select>
                      </Campo>
                      <Campo rotulo="Responsável">
                        <select value={responsavelId} onChange={e => setResponsavel(e.target.value)} style={selectSt}>
                          <option value="">Sem responsável</option>
                          {responsaveis.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                        </select>
                      </Campo>
                      <Campo rotulo="Origem (quando a linha não tiver)">
                        <select value={origemPadrao} onChange={e => setOrigemPadrao(e.target.value)} style={selectSt}>
                          <option value="">Nenhuma</option>
                          {ORIGEM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </Campo>
                    </div>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={clientes} onChange={e => setClientes(e.target.checked)} style={{ marginTop: 2 }} />
                      <span style={{ fontSize: 12.5, color: '#25402C' }}>
                        <strong>Já são clientes</strong> (carteira): entram como negócio <strong>Ganho</strong> e marcados como
                        cliente, sem data de ganho, para não contar como ganhos deste período nem entrar nas automações por tempo.
                      </span>
                    </label>
                    {exigidos.length > 0 && (
                      <Alerta tipo="aviso">
                        Para entrar na etapa {etapa?.nome}, cada contato precisa ter:{' '}
                        <strong>{exigidos.map(c => rotuloObrigatorio(c, camposFunil)).join(', ')}</strong>.
                        Mapeie essas colunas abaixo (ou escolha o responsável/origem aqui); linhas sem elas não serão importadas.
                      </Alerta>
                    )}
                    {funis.length === 0 && <Alerta tipo="erro">Nenhum funil ativo nesta unidade.</Alerta>}
                    {funil && funil.etapas.length === 0 && <Alerta tipo="erro">Este funil não tem etapa sem resultado (Ganho/Perdido) para receber os contatos.</Alerta>}
                  </Cartao>

                  <Cartao titulo="3. Colunas">
                    <div style={{ border: '1px solid #EBE7DA', borderRadius: 10, overflow: 'hidden' }}>
                      {arquivo.registros[0].map((cab, col) => (
                        <div key={col} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr) 220px', gap: 10, alignItems: 'center', padding: '8px 12px', borderTop: col ? '1px solid #F1EFE5' : 'none' }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#25402C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cab.trim() || `Coluna ${col + 1}`}
                          </span>
                          <span style={{ fontSize: 11.5, color: '#9AA79C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {amostra(col).join(' · ') || '(vazia)'}
                          </span>
                          <select
                            value={mapeamento[col] ?? 'ignorar'}
                            onChange={e => setMapeamento(m => m.map((d, i) => (i === col ? e.target.value as Destino : d)))}
                            style={selectSt}
                          >
                            <option value="ignorar">Ignorar</option>
                            <optgroup label="Contato">
                              {COLUNAS_LEAD.map(c => (
                                <option key={c} value={c} disabled={usados.has(c) && mapeamento[col] !== c}>
                                  {ROTULOS_COLUNA[c]}{c === 'nome' || c === 'telefone' || exigidos.includes(`lead:${c}`) ? ' *' : ''}
                                </option>
                              ))}
                              <option value="tags" disabled={usados.has('tags') && mapeamento[col] !== 'tags'}>Tags (separadas por vírgula)</option>
                            </optgroup>
                            {camposFunil.length > 0 && (
                              <optgroup label="Campos personalizados">
                                {camposFunil.map(c => {
                                  const d: Destino = `campo:${c.chave}`
                                  return <option key={c.id} value={d} disabled={usados.has(d) && mapeamento[col] !== d}>{c.rotulo}{exigidos.includes(c.chave) ? ' *' : ''}</option>
                                })}
                              </optgroup>
                            )}
                          </select>
                        </div>
                      ))}
                    </div>
                    {erroMapa && <Alerta tipo="erro">{erroMapa}</Alerta>}
                  </Cartao>

                  {!erroMapa && prep && (
                    <Cartao titulo="4. Conferência">
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 12 }}>
                        <Numero rotulo="Serão importados" valor={separacao ? separacao.novas.length : '…'} cor="#166534" />
                        <Numero rotulo="Já existem (pulados)" valor={separacao ? separacao.existentes.length : '…'} cor="#92400E" />
                        <Numero rotulo="Repetidos no arquivo (pulados)" valor={prep.repetidas.length} cor="#92400E" />
                        <Numero rotulo="Inválidos" valor={prep.invalidas.length} cor="#B91C1C" />
                      </div>
                      {buscaAtual?.erro && <Alerta tipo="erro">Não foi possível conferir os contatos que já existem. Recarregue a página.</Alerta>}
                      {prep.tagsDesconhecidas.length > 0 && (
                        <Alerta tipo="aviso">
                          Tags de cliente que não existem nesta unidade e serão ignoradas: {prep.tagsDesconhecidas.join(', ')}. Para usá-las,
                          crie em Configurações › Tags e escolha o arquivo de novo.
                        </Alerta>
                      )}
                      {problemas.length > 0 && (
                        <TabelaProblemas problemas={problemas.slice(0, MAX_PROBLEMAS_NA_TELA)} total={problemas.length} />
                      )}
                      {separacao && separacao.novas.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <p style={{ fontSize: 12, fontWeight: 700, color: '#71856F', margin: '0 0 6px' }}>Primeiros contatos a importar</p>
                          <div style={{ border: '1px solid #EBE7DA', borderRadius: 10, overflow: 'hidden' }}>
                            {separacao.novas.slice(0, 8).map(l => (
                              <div key={l.linha} style={{ display: 'flex', gap: 12, padding: '6px 12px', borderTop: '1px solid #F1EFE5', fontSize: 12 }}>
                                <span style={{ color: '#9AA79C', width: 54 }}>linha {l.linha}</span>
                                <span style={{ color: '#25402C', fontWeight: 700, flex: 1 }}>{[l.dados.nome, l.dados.sobrenome].filter(Boolean).join(' ')}</span>
                                <span style={{ color: '#71856F' }}>{l.dados.telefone}</span>
                                {l.tagIds.length > 0 && <span style={{ color: '#9AA79C' }}>{l.tagIds.length} tag(s)</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {erroEnvio && <Alerta tipo="erro">{erroEnvio}</Alerta>}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                        <button
                          onClick={() => void importar()}
                          disabled={enviando || !separacao || separacao.novas.length === 0 || !stageId}
                          style={{
                            padding: '10px 22px', fontSize: 13.5, fontWeight: 800, border: 'none', borderRadius: 999,
                            cursor: enviando ? 'default' : 'pointer',
                            background: enviando || !separacao || separacao.novas.length === 0 || !stageId ? '#EBE7DA' : '#3E9849',
                            color: enviando || !separacao || separacao.novas.length === 0 || !stageId ? '#9AA79C' : '#fff',
                          }}
                        >
                          {enviando ? 'Importando…' : `Importar ${separacao?.novas.length ?? ''} contato(s)`}
                        </button>
                      </div>
                    </Cartao>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Relatorio({ relatorio, erro, onBaixar, onRecomecar }: {
  relatorio: RelatorioImportacao; erro: string; onBaixar: () => void; onRecomecar: () => void
}) {
  const problemas: Problema[] = [
    ...relatorio.invalidas.map(i => ({ linha: i.linha, situacao: 'Inválida', detalhe: i.motivo })),
    ...relatorio.repetidas.map(r => ({ linha: r.linha, situacao: 'Repetida no arquivo', detalhe: `${r.telefone} já está na linha ${r.primeiraLinha}` })),
    ...relatorio.existentes.map(e => ({ linha: e.linha, situacao: 'Já existe', detalhe: `${e.telefone} já está cadastrado nesta unidade` })),
  ].sort((a, b) => a.linha - b.linha)
  return (
    <Cartao titulo="Resultado da importação">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 12 }}>
        <Numero rotulo="Importados" valor={relatorio.importados} cor="#166534" />
        <Numero rotulo="Já existiam (pulados)" valor={relatorio.existentes.length} cor="#92400E" />
        <Numero rotulo="Repetidos no arquivo (pulados)" valor={relatorio.repetidas.length} cor="#92400E" />
        <Numero rotulo="Inválidos" valor={relatorio.invalidas.length} cor="#B91C1C" />
      </div>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {relatorio.avisos.map(a => <Alerta key={a} tipo="aviso">{a}</Alerta>)}
      {relatorio.tagsDesconhecidas.length > 0 && (
        <Alerta tipo="aviso">Tags ignoradas (não há tag de cliente com esse nome na unidade): {relatorio.tagsDesconhecidas.join(', ')}</Alerta>
      )}
      {problemas.length > 0 && <TabelaProblemas problemas={problemas.slice(0, MAX_PROBLEMAS_NA_TELA)} total={problemas.length} />}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
        {problemas.length > 0 && (
          <button onClick={onBaixar} style={botaoSecundario}>Baixar pulados e inválidos (CSV)</button>
        )}
        <button onClick={onRecomecar} style={botaoSecundario}>Importar outro arquivo</button>
        <Link href="/funil" style={{ ...botaoSecundario, background: '#3E9849', color: '#fff', border: 'none' }}>Ver no funil</Link>
      </div>
    </Cartao>
  )
}

function TabelaProblemas({ problemas, total }: { problemas: Problema[]; total: number }) {
  return (
    <div style={{ border: '1px solid #EBE7DA', borderRadius: 10, overflow: 'hidden', marginTop: 8 }}>
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
        {problemas.map((p, i) => (
          <div key={`${p.linha}-${i}`} style={{ display: 'flex', gap: 12, padding: '6px 12px', borderTop: i ? '1px solid #F1EFE5' : 'none', fontSize: 12 }}>
            <span style={{ color: '#9AA79C', width: 54, flexShrink: 0 }}>linha {p.linha}</span>
            <span style={{ color: p.situacao === 'Inválida' ? '#B91C1C' : '#92400E', fontWeight: 700, width: 140, flexShrink: 0 }}>{p.situacao}</span>
            <span style={{ color: '#25402C', minWidth: 0, overflowWrap: 'anywhere' }}>{p.detalhe}</span>
          </div>
        ))}
      </div>
      {total > problemas.length && (
        <p style={{ fontSize: 11, color: '#9AA79C', margin: 0, padding: '6px 12px', borderTop: '1px solid #F1EFE5' }}>
          … e mais {total - problemas.length}
        </p>
      )}
    </div>
  )
}

function Cartao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section style={{ background: '#fff', border: '1px solid #EBE7DA', borderRadius: 14, padding: '16px 18px' }}>
      <h2 style={{ fontSize: 14, fontWeight: 800, color: '#25402C', margin: '0 0 12px' }}>{titulo}</h2>
      {children}
    </section>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#71856F', marginBottom: 5 }}>{rotulo}</span>
      {children}
    </label>
  )
}

function Numero({ rotulo, valor, cor }: { rotulo: string; valor: number | string; cor: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, color: '#9AA79C', margin: 0 }}>{rotulo}</p>
      <p style={{ fontSize: 20, fontWeight: 800, color: cor, margin: '1px 0 0' }}>{valor}</p>
    </div>
  )
}

function Alerta({ tipo, children }: { tipo: 'erro' | 'aviso'; children: React.ReactNode }) {
  const cores = tipo === 'erro' ? { bg: '#FEE2E2', fg: '#B91C1C' } : { bg: '#FEF3C7', fg: '#92400E' }
  return (
    <div style={{ padding: '9px 13px', background: cores.bg, borderRadius: 10, marginTop: 10 }}>
      <p style={{ fontSize: 12, color: cores.fg, margin: 0 }}>{children}</p>
    </div>
  )
}

const selectSt: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 12.5, border: '1px solid #EBE7DA',
  borderRadius: 10, outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#25402C', cursor: 'pointer',
}

const botaoSecundario: React.CSSProperties = {
  padding: '9px 18px', fontSize: 13, fontWeight: 700, border: '1px solid #EBE7DA', borderRadius: 999,
  background: '#fff', color: '#25402C', cursor: 'pointer', textDecoration: 'none',
}
