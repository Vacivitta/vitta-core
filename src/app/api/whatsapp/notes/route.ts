import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { getAccessibleConversation } from '@/lib/auth/access'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[WA] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  return createClient(url, key)
}

// POST /api/whatsapp/notes
// Body: { conversation_id, content }
export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { conversation_id, content, mencoes } = await req.json() as { conversation_id: string; content: string; mencoes?: string[] }
  if (!conversation_id || !content?.trim()) {
    return NextResponse.json({ error: 'conversation_id e content obrigatórios' }, { status: 400 })
  }

  // Autorização: a conversa precisa ser de uma unidade do usuário (RLS)
  const conv = await getAccessibleConversation(supabase, conversation_id)
  if (!conv) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })

  const admin = adminClient()

  const { data, error } = await admin.from('wa_internal_notes').insert({
    conversation_id,
    unit_id:   conv.unit_id,
    content:   content.trim(),
    author_id: user.id,
    mencoes:   mencoes && mencoes.length > 0 ? mencoes : [],
  }).select('id, content, author_id, created_at').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ note: data })
}
