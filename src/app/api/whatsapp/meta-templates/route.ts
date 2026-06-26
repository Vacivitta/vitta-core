/**
 * /api/whatsapp/meta-templates
 * Proxy para a API de templates do Meta (WABA), sincronizando com tabela local.
 *
 * Requer env: WHATSAPP_WABA_ID, WHATSAPP_ACCESS_TOKEN
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { getWaCredentials } from '@/lib/whatsapp/credentials'

const META = 'https://graph.facebook.com/v20.0'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[WA] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  return createClient(url, key)
}

async function getCredentials(unitId?: string) {
  const creds = await getWaCredentials(unitId)
  const wabaId      = creds.wabaId      || process.env.WHATSAPP_WABA_ID      || ''
  const accessToken = creds.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || ''
  return { wabaId, accessToken }
}

function metaHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
}

// ── GET — lista templates do Meta + status real ───────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = adminClient()
  const { data: profile } = await admin.from('profiles').select('unit_id').eq('id', user.id).single()
  const unitId = profile?.unit_id ?? undefined

  const { wabaId, accessToken } = await getCredentials(unitId)
  if (!wabaId)      return NextResponse.json({ error: 'WABA ID não configurado. Acesse Configurações → WhatsApp API e salve o WABA ID.' }, { status: 500 })
  if (!accessToken) return NextResponse.json({ error: 'Token não configurado. Acesse Configurações → WhatsApp API.' }, { status: 500 })

  const fields = 'id,name,status,category,language,components,rejected_reason'
  const url    = `${META}/${wabaId}/message_templates?fields=${fields}&limit=100`

  const res  = await fetch(url, { headers: metaHeaders(accessToken) })
  const data = await res.json() as { data?: MetaTemplate[]; error?: { message: string } }

  if (data.error) return NextResponse.json({ error: data.error.message }, { status: res.status })

  const templates = data.data ?? []

  // Sincronizar aprovados na tabela local para o picker do chat funcionar offline
  if (templates.length > 0 && unitId) {
    const approved = templates.filter(t => t.status === 'APPROVED')
    for (const t of approved) {
      const bodyComponent = t.components?.find(c => c.type === 'BODY')
      const bodyText = bodyComponent?.text ?? ''
      await admin.from('wa_message_templates')
        .upsert({
          unit_id:       unitId,
          name:          t.name,
          content:       bodyText,
          category:      'meta_api',
          template_name: t.name,
          language:      t.language,
          ativo:         true,
        }, { onConflict: 'unit_id,name,category' })
    }
  }

  return NextResponse.json({ templates })
}

// ── POST — cria template no Meta + salva localmente ───────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = adminClient()
  const { data: profile } = await admin.from('profiles').select('unit_id').eq('id', user.id).single()
  const unitId = profile?.unit_id ?? undefined

  const { wabaId, accessToken } = await getCredentials(unitId)
  if (!wabaId)      return NextResponse.json({ error: 'WABA ID não configurado. Acesse Configurações → WhatsApp API e salve o WABA ID.' }, { status: 500 })
  if (!accessToken) return NextResponse.json({ error: 'Token não configurado. Acesse Configurações → WhatsApp API.' }, { status: 500 })

  const body = await req.json() as CreateTemplateBody

  if (!body.name || !/^[a-z0-9_]+$/.test(body.name))
    return NextResponse.json({ error: 'Nome inválido: use apenas letras minúsculas, números e underscore' }, { status: 400 })
  if (!body.body_text?.trim())
    return NextResponse.json({ error: 'Corpo da mensagem é obrigatório' }, { status: 400 })

  const components: MetaComponent[] = []
  if (body.header_type && body.header_text?.trim())
    components.push({ type: 'HEADER', format: body.header_type, text: body.header_text.trim() })
  components.push({ type: 'BODY', text: body.body_text.trim() })
  if (body.footer_text?.trim())
    components.push({ type: 'FOOTER', text: body.footer_text.trim() })
  if (body.buttons && body.buttons.length > 0)
    components.push({ type: 'BUTTONS', buttons: body.buttons })

  const payload = { name: body.name, category: body.category ?? 'UTILITY', language: body.language ?? 'pt_BR', components }

  const res    = await fetch(`${META}/${wabaId}/message_templates`, {
    method: 'POST', headers: metaHeaders(accessToken), body: JSON.stringify(payload),
  })
  const result = await res.json() as { id?: string; status?: string; error?: { message: string } }

  if (result.error || !res.ok)
    return NextResponse.json({ error: result.error?.message ?? 'Erro ao criar template no Meta' }, { status: res.status })

  if (unitId) {
    await admin.from('wa_message_templates').upsert({
      unit_id: unitId, name: body.name, content: body.body_text.trim(),
      category: 'meta_api', template_name: body.name, language: body.language ?? 'pt_BR', ativo: false,
    }, { onConflict: 'unit_id,name,category' })
  }

  return NextResponse.json({ success: true, id: result.id, status: result.status ?? 'PENDING' })
}

// ── DELETE — deleta template do Meta + desativa localmente ────────────────────
export async function DELETE(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = adminClient()
  const { data: profile } = await admin.from('profiles').select('unit_id').eq('id', user.id).single()
  const unitId = profile?.unit_id ?? undefined

  const { wabaId, accessToken } = await getCredentials(unitId)
  if (!wabaId)      return NextResponse.json({ error: 'WABA ID não configurado. Acesse Configurações → WhatsApp API e salve o WABA ID.' }, { status: 500 })
  if (!accessToken) return NextResponse.json({ error: 'Token não configurado. Acesse Configurações → WhatsApp API.' }, { status: 500 })

  const name   = req.nextUrl.searchParams.get('name')
  const hsmId  = req.nextUrl.searchParams.get('hsm_id')
  if (!name) return NextResponse.json({ error: 'name é obrigatório' }, { status: 400 })

  // hsm_id identifica a variante exata; sem ele a Meta pode rejeitar com 400
  const deleteParams = new URLSearchParams({ name })
  if (hsmId) deleteParams.set('hsm_id', hsmId)

  const res = await fetch(`${META}/${wabaId}/message_templates?${deleteParams.toString()}`, {
    method: 'DELETE', headers: metaHeaders(accessToken),
  })

  if (!res.ok) {
    const body = await res.text()
    let msg = 'Erro ao deletar no Meta'
    try { msg = (JSON.parse(body) as { error?: { message: string } }).error?.message ?? msg } catch { /* raw text */ }
    console.error(`[meta-templates DELETE] status=${res.status} name=${name} body=${body}`)
    return NextResponse.json({ error: msg }, { status: res.status })
  }

  // Só desativa no banco após confirmação da Meta
  await admin.from('wa_message_templates').update({ ativo: false })
    .eq('template_name', name).eq('category', 'meta_api')

  return NextResponse.json({ success: true })
}

// ── Types internos ────────────────────────────────────────────────────────────

interface MetaTemplate {
  id: string; name: string; status: string; category: string; language: string
  components?: MetaComponent[]; rejected_reason?: string
}

interface MetaComponent {
  type: string; format?: string; text?: string; buttons?: MetaButton[]
}

interface MetaButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone_number?: string
}

interface CreateTemplateBody {
  name:        string
  category:    'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  language:    string
  header_type?: 'TEXT'
  header_text?: string
  body_text:   string
  footer_text?: string
  buttons?:    MetaButton[]
}
