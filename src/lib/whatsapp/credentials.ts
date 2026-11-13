import { createClient } from '@supabase/supabase-js'
import type { ConexaoEnvio } from '@/lib/whatsapp/envio-qrcode'

export interface WaCredentials {
  phoneNumberId: string
  accessToken:   string
  verifyToken:   string
  wabaId:        string
}

interface WaConfigRow {
  phone_number_id: string | null
  access_token:    string | null
  verify_token:    string | null
  waba_id:         string | null
}

let _admin: ReturnType<typeof createClient> | null = null

function adminClient() {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
    _admin = createClient(url, key)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return _admin as any
}

const SEM_CREDENCIAIS: WaCredentials = { phoneNumberId: '', accessToken: '', verifyToken: '', wabaId: '' }

/**
 * Retorna as credenciais do WhatsApp da unidade, lidas do `wa_config` ativo dela.
 *
 * Não há fallback para as variáveis de ambiente: elas são o número da clínica, e
 * uma unidade sem `wa_config` (ex.: uma unidade nova) enviaria por ele. Sem
 * configuração, devolve campos vazios — os chamadores já tratam isso como
 * "WhatsApp não configurado" (503). Registra no log qual parte falta, sem
 * nunca registrar o token.
 *
 * @param unitId - Unidade dona do envio; sem unidade, não há credenciais
 */
export async function getWaCredentials(unitId: string | null | undefined): Promise<WaCredentials> {
  if (unitId) {
    const result = await adminClient()
      .from('wa_config')
      .select('phone_number_id, access_token, verify_token, waba_id')
      .eq('unit_id', unitId)
      .eq('is_active', true)
      .maybeSingle()

    const data = result.data as WaConfigRow | null

    if (data?.phone_number_id && data?.access_token) {
      return {
        phoneNumberId: data.phone_number_id,
        accessToken:   data.access_token,
        verifyToken:   data.verify_token ?? '',
        wabaId:        data.waba_id      ?? '',
      }
    }

    // Só presença dos campos — nunca o valor do token
    console.warn(
      `[WA credenciais] unidade ${unitId} sem WhatsApp utilizável:`,
      data
        ? `wa_config ativo incompleto (phone_number_id: ${data.phone_number_id ? 'ok' : 'falta'}, access_token: ${data.access_token ? 'ok' : 'falta'})`
        : `nenhum wa_config ativo${result.error ? ` (erro na consulta: ${result.error.message})` : ''}`,
    )
  } else {
    console.warn('[WA credenciais] chamada sem unidade — envio bloqueado')
  }

  return SEM_CREDENCIAIS
}

interface ConexaoRow {
  tipo:         'oficial' | 'qrcode'
  ativo:        boolean
  wa_config_id: string | null
}

/**
 * Retorna as credenciais da conexão da conversa (143). A resposta sai sempre pela
 * conexão em que a conversa está, nunca pelo número da unidade ativa.
 *
 * Conexão oficial: o `wa_config` ligado a ela. QR Code ainda não envia (entrega 2
 * da Fase 3·2) e devolve campos vazios, que os chamadores tratam como 503.
 *
 * @param conexaoId - `wa_conversations.conexao_id`
 */
export async function getCredenciaisDaConexao(conexaoId: string | null | undefined): Promise<WaCredentials> {
  if (!conexaoId) {
    console.warn('[WA credenciais] conversa sem conexão — envio bloqueado')
    return SEM_CREDENCIAIS
  }
  const { data: conexao } = await adminClient()
    .from('conexoes')
    .select('tipo, ativo, wa_config_id')
    .eq('id', conexaoId)
    .maybeSingle() as { data: ConexaoRow | null }

  if (!conexao?.ativo || conexao.tipo !== 'oficial' || !conexao.wa_config_id) {
    console.warn(`[WA credenciais] conexão ${conexaoId} sem envio: ${!conexao ? 'não encontrada' : !conexao.ativo ? 'inativa' : conexao.tipo === 'qrcode' ? 'QR Code ainda não envia' : 'sem wa_config'}`)
    return SEM_CREDENCIAIS
  }

  const { data } = await adminClient()
    .from('wa_config')
    .select('phone_number_id, access_token, verify_token, waba_id')
    .eq('id', conexao.wa_config_id)
    .eq('is_active', true)
    .maybeSingle() as { data: WaConfigRow | null }

  if (!data?.phone_number_id || !data.access_token) {
    console.warn(`[WA credenciais] conexão ${conexaoId}: wa_config inativo ou incompleto`)
    return SEM_CREDENCIAIS
  }
  return {
    phoneNumberId: data.phone_number_id,
    accessToken:   data.access_token,
    verifyToken:   data.verify_token ?? '',
    wabaId:        data.waba_id      ?? '',
  }
}

/** Tipo e estado da conexão, para escolher o canal de envio (Meta ou QR Code). */
export async function dadosDaConexao(conexaoId: string | null | undefined): Promise<ConexaoEnvio | null> {
  if (!conexaoId) return null
  const { data } = await adminClient()
    .from('conexoes')
    .select('id, tipo, instancia, ativo, status')
    .eq('id', conexaoId)
    .maybeSingle() as { data: ConexaoEnvio | null }
  return data
}

/**
 * Conexão oficial da unidade (no máximo uma, 143), ou `null` se a unidade não tem.
 * Usada para abrir conversa nova pela unidade.
 */
export async function conexaoOficialDaUnidade(unitId: string): Promise<string | null> {
  const { data } = await adminClient()
    .from('conexoes')
    .select('id')
    .eq('unit_id', unitId)
    .eq('tipo', 'oficial')
    .maybeSingle() as { data: { id: string } | null }
  return data?.id ?? null
}

/**
 * Para o webhook: verifica se o token informado pelo Meta
 * bate com algum verify_token ativo (ou com o env var fallback).
 */
export async function isValidVerifyToken(token: string): Promise<boolean> {
  if (!token) return false

  const result = await adminClient()
    .from('wa_config')
    .select('id')
    .eq('verify_token', token)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (result.data) return true

  return token === (process.env.WHATSAPP_VERIFY_TOKEN ?? '')
}
