import { redirect }     from 'next/navigation'
import { headers }      from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import WhatsAppConfigClient from './WhatsAppConfigClient'

export const metadata = { title: 'WhatsApp API — VittaDesk' }

const MULTI_UNIT_PERFIS = ['admin', 'gestor_vacivitta']

export default async function WhatsAppConfigPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('unit_id, perfil')
    .eq('id', user.id)
    .single()

  if (!profile || profile.perfil === 'atendente') redirect('/configuracoes/funis')

  const headersList = await headers()
  const host        = headersList.get('host') ?? 'localhost:3000'
  const protocol    = host.startsWith('localhost') ? 'http' : 'https'
  const webhookUrl  = `${protocol}://${host}/api/whatsapp/webhook`

  const isMultiUnit = MULTI_UNIT_PERFIS.includes(profile.perfil)

  // Admin/gestor_vacivitta: carrega todas as unidades
  // Gestor de unidade: só a sua
  const [unitsResult, configsResult] = await Promise.all([
    isMultiUnit
      ? supabase.from('units').select('id, nome').order('nome')
      : supabase.from('units').select('id, nome').eq('id', profile.unit_id),

    // Carrega configs existentes para pré-preencher e encontrar o verify_token global
    supabase
      .from('wa_config')
      .select('unit_id, phone_number_id, access_token, verify_token, waba_id, display_phone, updated_at')
      .order('updated_at', { ascending: false }),
  ])

  const units   = unitsResult.data   ?? []
  const configs = configsResult.data ?? []

  // verify_token é compartilhado — pega o primeiro configurado
  const globalVerifyToken = configs.find(c => c.verify_token)?.verify_token ?? ''

  // Config da primeira unidade (ou a do próprio usuário)
  const firstUnitId = isMultiUnit ? (units[0]?.id ?? profile.unit_id) : profile.unit_id
  const firstConfig = configs.find(c => c.unit_id === firstUnitId)

  const maskToken = (t: string | null | undefined) =>
    t ? t.slice(0, 6) + '•'.repeat(12) + t.slice(-4) : ''

  return (
    <WhatsAppConfigClient
      webhookUrl={webhookUrl}
      isMultiUnit={isMultiUnit}
      units={units}
      globalVerifyToken={globalVerifyToken}
      initialUnitId={firstUnitId}
      initialConfig={{
        phone_number_id: firstConfig?.phone_number_id ?? '',
        access_token:    maskToken(firstConfig?.access_token),
        waba_id:         firstConfig?.waba_id         ?? '',
        display_phone:   firstConfig?.display_phone   ?? '',
        configured:      !!(firstConfig?.phone_number_id && firstConfig?.access_token),
        updated_at:      firstConfig?.updated_at      ?? null,
      }}
    />
  )
}
