import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { resumoErro } from '@/lib/log-seguro'
import type { AppErrorOrigem } from '@/types/database'

export interface ContextoErro {
  origem:  AppErrorOrigem
  rota?:   string
  metodo?: string
  digest?: string
}

const MAX_POR_ASSINATURA_POR_MINUTO = 5
const MAX_TOTAL_POR_MINUTO          = 60
const MAX_STACK                     = 4096
const MAX_MENSAGEM                  = 1000
const MINUTO                        = 60_000

interface Janela { inicio: number; gravadas: number; suprimidas: number }

const janelas = new Map<string, Janela>()
let janelaTotal = { inicio: 0, gravadas: 0 }

/**
 * Tira da mensagem o que pode identificar pessoas ou dar acesso: e-mails,
 * tokens, UUIDs e sequências de dígitos (telefone, CPF, ids).
 * `resumoErro` só evita objetos inteiros; o `message` de um Error pode trazer
 * o telefone ou o texto que falhou.
 */
export function mascararDados(texto: string): string {
  return mascararSegredos(texto)
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '<numero>')
    .replace(/\d{4,}/g, '<numero>')
}

// Na stack os números são linha:coluna, necessários para achar o código
function mascararSegredos(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/\bBearer\s+\S+/gi, 'Bearer <token>')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<token>')
}

function tipoDoErro(erro: unknown): string {
  if (erro instanceof Error) return erro.name || 'Error'
  if (erro === null) return 'null'
  if (typeof erro === 'object') return 'objeto'
  return typeof erro
}

function framesDaStack(erro: unknown): string | null {
  if (!(erro instanceof Error) || !erro.stack) return null
  const frames = erro.stack
    .split('\n')
    .filter(linha => linha.trimStart().startsWith('at '))
    .map(linha => linha.replace(/[^\s(]*[\\/](?=(\.next|node_modules)[\\/])/g, ''))
    .join('\n')
  return frames ? mascararSegredos(frames).slice(0, MAX_STACK) : null
}

function assinaturaDe(origem: AppErrorOrigem, rota: string, tipo: string, mensagem: string): string {
  const normalizada = mensagem.replace(/<\w+>/g, '').replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  return createHash('sha256').update([origem, rota, tipo, normalizada].join('\u0000')).digest('hex')
}

/** Devolve quantas ocorrências gravar agora (0 = suprimir) e acumula as suprimidas. */
function cotaDe(assinatura: string, agora: number): number {
  if (agora - janelaTotal.inicio >= MINUTO) janelaTotal = { inicio: agora, gravadas: 0 }

  let janela = janelas.get(assinatura)
  if (!janela || agora - janela.inicio >= MINUTO) {
    if (janelas.size >= 500) {
      for (const [chave, j] of janelas) if (agora - j.inicio >= MINUTO) janelas.delete(chave)
      if (janelas.size >= 500) janelas.clear()
    }
    janela = { inicio: agora, gravadas: 0, suprimidas: janela?.suprimidas ?? 0 }
    janelas.set(assinatura, janela)
  }

  if (janela.gravadas >= MAX_POR_ASSINATURA_POR_MINUTO || janelaTotal.gravadas >= MAX_TOTAL_POR_MINUTO) {
    janela.suprimidas++
    return 0
  }
  janela.gravadas++
  janelaTotal.gravadas++
  const quantidade = 1 + janela.suprimidas
  janela.suprimidas = 0
  return quantidade
}

/**
 * Grava o erro em `app_errors` (agrupado por assinatura) para a tela
 * Configurações → Erros do servidor. Nunca lança.
 *
 * As ocorrências acima do limite por minuto não viram chamadas ao banco: são
 * somadas na próxima gravação da mesma assinatura.
 */
export async function registrarErro(erro: unknown, contexto: ContextoErro): Promise<void> {
  try {
    const tipo     = tipoDoErro(erro).slice(0, 200)
    const mensagem = mascararDados(resumoErro(erro)).slice(0, MAX_MENSAGEM)
    const rota     = (contexto.rota ?? '').split('?')[0].slice(0, 300)
    const assinatura = assinaturaDe(contexto.origem, rota, tipo, mensagem)

    const quantidade = cotaDe(assinatura, Date.now())
    if (quantidade === 0) return

    const { error } = await createAdminClient().rpc('registrar_erro_app', {
      p_assinatura: assinatura,
      p_origem:     contexto.origem,
      p_rota:       rota || null,
      p_metodo:     contexto.metodo ?? null,
      p_tipo:       tipo,
      p_mensagem:   mensagem,
      p_stack:      framesDaStack(erro),
      p_digest:     contexto.digest ?? null,
      p_quantidade: quantidade,
    })
    if (error) console.error('[erros] falha ao registrar erro do servidor:', resumoErro(error))
  } catch (e) {
    console.error('[erros] falha ao registrar erro do servidor:', resumoErro(e))
  }
}
