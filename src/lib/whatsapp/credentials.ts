import { createClient } from '@supabase/supabase-js'

export interface WaCredentials {
  phoneNumberId: string
  accessToken:   string
  verifyToken:   string
  wabaId:        string
}

let _admin: ReturnType<typeof createClient> | null = null

function adminClient() {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
    _admin = createClient(url, key)
  }
  return _admin
}

/**
 * Retorna as credenciais do WhatsApp para uma unidade.
 * Prioridade: wa_config no banco → env vars (compatibilidade).
 */
interface WaConfigRow {
  phone_number_id: string | null
  access_token:    string | null
  verify_token:    string | null
  waba_id:         string | null
}

export async function getWaCredentials(unitId?: string): Promise<WaCredentials> {
  if (unitId) {
    const { data } = await adminClient()
      .from('wa_config')
      .select('phone_number_id, access_token, verify_token, waba_id')
      .eq('unit_id', unitId)
      .eq('is_active', true)
      .maybeSingle() as { data: WaConfigRow | null; error: unknown }

    if (data?.phone_number_id && data?.access_token) {
      return {
        phoneNumberId: data.phone_number_id,
        accessToken:   data.access_token,
        verifyToken:   data.verify_token  ?? '',
        wabaId:        data.waba_id       ?? '',
      }
    }
  }

  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    accessToken:   process.env.WHATSAPP_ACCESS_TOKEN    ?? '',
    verifyToken:   process.env.WHATSAPP_VERIFY_TOKEN    ?? '',
    wabaId:        process.env.WHATSAPP_WABA_ID         ?? '',
  }
}

/**
 * Para o webhook: verifica se o token informado pelo Meta
 * bate com algum verify_token ativo (ou com o env var fallback).
 */
export async function isValidVerifyToken(token: string): Promise<boolean> {
  if (!token) return false

  // Verifica no banco primeiro
  const { data } = await adminClient()
    .from('wa_config')
    .select('id')
    .eq('verify_token', token)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle() as { data: { id: string } | null; error: unknown }

  if (data) return true

  // Fallback: env var
  return token === (process.env.WHATSAPP_VERIFY_TOKEN ?? '')
}
