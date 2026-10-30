import { createClient } from '@supabase/supabase-js'

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
