import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars ausentes')
  return createClient(url, key)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const { conversation_id } = await req.json() as { conversation_id?: unknown }
  if (typeof conversation_id !== 'string' || !conversation_id) {
    return NextResponse.json({ error: 'conversation_id obrigatório' }, { status: 400 })
  }

  // Autorização: a query usa o client do usuário (RLS) — só encontra conversas da própria unidade
  const { data: conv } = await supabase
    .from('wa_conversations')
    .select('id')
    .eq('id', conversation_id)
    .maybeSingle()
  if (!conv) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })

  const admin = adminClient()
  const { error } = await admin
    .from('wa_conversations')
    .update({ unread_count: 0 })
    .eq('id', conversation_id)

  if (error) {
    console.error('[mark-read] erro:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
