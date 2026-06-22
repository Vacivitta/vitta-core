import { NextRequest, NextResponse } from 'next/server'
import { createClient }             from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

const META_API_URL = 'https://graph.facebook.com/v20.0'
const MULTI_UNIT_PERFIS = ['admin', 'gestor_vacivitta']

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

interface Caller { perfil: string; unitId: string }

async function getCaller(): Promise<Caller | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('unit_id, perfil')
    .eq('id', user.id)
    .single()
  if (!profile) return null
  return { perfil: profile.perfil, unitId: profile.unit_id }
}

/** Admin e gestor_vacivitta podem acessar qualquer unidade. Outros, apenas a sua. */
function resolveUnitId(caller: Caller, requestedUnitId?: string | null): string | null {
  if (MULTI_UNIT_PERFIS.includes(caller.perfil)) {
    return requestedUnitId ?? caller.unitId
  }
  return caller.unitId
}

function maskToken(token: string | null | undefined): string {
  if (!token) return ''
  return token.slice(0, 6) + '•'.repeat(12) + token.slice(-4)
}

// ── GET /api/whatsapp/config?unit_id=xxx ─────────────────────────────────────
export async function GET(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const unitId = resolveUnitId(caller, req.nextUrl.searchParams.get('unit_id'))
  if (!unitId) return NextResponse.json({ error: 'Unidade não encontrada' }, { status: 400 })

  const { data } = await adminClient()
    .from('wa_config')
    .select('phone_number_id, access_token, verify_token, waba_id, display_phone, is_active, updated_at')
    .eq('unit_id', unitId)
    .maybeSingle()

  return NextResponse.json({
    phone_number_id: data?.phone_number_id ?? '',
    access_token:    maskToken(data?.access_token),
    verify_token:    data?.verify_token    ?? '',
    waba_id:         data?.waba_id         ?? '',
    display_phone:   data?.display_phone   ?? '',
    is_active:       data?.is_active       ?? true,
    updated_at:      data?.updated_at      ?? null,
    configured:      !!(data?.phone_number_id && data?.access_token),
  })
}

// ── POST /api/whatsapp/config ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const body = await req.json() as {
    unit_id?:        string
    phone_number_id?: string
    access_token?:    string
    verify_token?:    string
    waba_id?:         string
    display_phone?:   string
  }

  const unitId = resolveUnitId(caller, body.unit_id)
  if (!unitId) return NextResponse.json({ error: 'Unidade não encontrada' }, { status: 400 })

  const { phone_number_id, access_token, verify_token, waba_id, display_phone } = body

  if (!phone_number_id?.trim() || !access_token?.trim() || !verify_token?.trim()) {
    return NextResponse.json(
      { error: 'phone_number_id, access_token e verify_token são obrigatórios' },
      { status: 400 },
    )
  }

  // Se o token ainda está mascarado (não foi alterado), mantém o valor atual do banco
  let finalToken = access_token.trim()
  if (finalToken.includes('•')) {
    const { data: existing } = await adminClient()
      .from('wa_config')
      .select('access_token')
      .eq('unit_id', unitId)
      .maybeSingle()
    finalToken = existing?.access_token ?? finalToken
  }

  const { error } = await adminClient()
    .from('wa_config')
    .upsert({
      unit_id:         unitId,
      phone_number_id: phone_number_id.trim(),
      access_token:    finalToken,
      verify_token:    verify_token.trim(),
      waba_id:         waba_id?.trim()       || null,
      display_phone:   display_phone?.trim() || null,
      is_active:       true,
    }, { onConflict: 'unit_id' })

  if (error) {
    console.error('[wa_config] upsert error:', error)
    return NextResponse.json({ error: 'Erro ao salvar configuração' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// ── PUT /api/whatsapp/config — Testar conexão com o Meta ─────────────────────
export async function PUT(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const body = await req.json() as { phone_number_id: string; access_token: string }
  const { phone_number_id, access_token } = body

  if (!phone_number_id?.trim() || !access_token?.trim() || access_token.includes('•')) {
    return NextResponse.json({ error: 'Informe o token completo para testar' }, { status: 400 })
  }

  try {
    const res = await fetch(
      `${META_API_URL}/${phone_number_id.trim()}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${access_token.trim()}` } },
    )
    const json = await res.json() as {
      display_phone_number?: string
      verified_name?:        string
      quality_rating?:       string
      error?:                { message: string }
    }

    if (!res.ok || json.error) {
      return NextResponse.json(
        { success: false, error: json.error?.message ?? 'Credenciais inválidas' },
        { status: 400 },
      )
    }

    return NextResponse.json({
      success: true,
      phone:   json.display_phone_number,
      name:    json.verified_name,
      quality: json.quality_rating,
    })
  } catch {
    return NextResponse.json({ success: false, error: 'Erro de rede ao contatar a API do Meta' }, { status: 500 })
  }
}
