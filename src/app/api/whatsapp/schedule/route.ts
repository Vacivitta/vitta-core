import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[WA] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  return createClient(url, key)
}

// POST /api/whatsapp/schedule
// Body texto:    { conversation_id, content, scheduled_for (ISO) }
// Body template: { conversation_id, type: "template", template_name, language, components, content (texto renderizado p/ exibição), scheduled_for }
export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const body = await req.json() as {
    conversation_id: string; content: string; scheduled_for: string
    type?: 'text' | 'template'; template_name?: string; language?: string; components?: object[]
  }
  const { conversation_id, content, scheduled_for, type = 'text', template_name, language, components } = body

  if (!conversation_id || !content?.trim() || !scheduled_for) {
    return NextResponse.json({ error: 'conversation_id, content e scheduled_for são obrigatórios' }, { status: 400 })
  }
  if (type === 'template' && !template_name) {
    return NextResponse.json({ error: 'template_name obrigatório para agendar template' }, { status: 400 })
  }
  if (new Date(scheduled_for) <= new Date()) {
    return NextResponse.json({ error: 'A data de agendamento deve ser no futuro' }, { status: 400 })
  }

  const admin = adminClient()

  const { data: conv } = await admin
    .from('wa_conversations').select('unit_id').eq('id', conversation_id).single()
  if (!conv) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })

  const { data, error } = await admin.from('wa_scheduled_messages').insert({
    conversation_id,
    unit_id:       conv.unit_id,
    content:       content.trim(),
    type,
    template_name: type === 'template' ? template_name : null,
    language:      type === 'template' ? (language ?? 'pt_BR') : null,
    components:    type === 'template' ? (components ?? []) : null,
    scheduled_for: new Date(scheduled_for).toISOString(),
    status:        'pending',
    created_by:    user.id,
  }).select('id, scheduled_for').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // System note in chat so the team can see it
  const label = type === 'template' ? `📋 Template "${template_name}"` : 'Mensagem agendada'
  await admin.from('wa_internal_notes').insert({
    conversation_id,
    unit_id:   conv.unit_id,
    author_id: user.id,
    content:   `🕐 ${label} para ${new Date(scheduled_for).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}:\n"${content.trim()}"`,
  })

  return NextResponse.json({ success: true, id: data.id, scheduled_for: data.scheduled_for })
}

// GET /api/whatsapp/schedule?conversation_id=...
// Returns pending scheduled messages for a conversation
export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const convId = req.nextUrl.searchParams.get('conversation_id')
  if (!convId) return NextResponse.json({ error: 'conversation_id obrigatório' }, { status: 400 })

  const { data } = await supabase
    .from('wa_scheduled_messages')
    .select('id, content, scheduled_for, status')
    .eq('conversation_id', convId)
    .eq('status', 'pending')
    .order('scheduled_for')

  return NextResponse.json(data ?? [])
}

// DELETE /api/whatsapp/schedule?id=...
export async function DELETE(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  // Verify ownership: fetch the row first and confirm unit_id matches the caller's unit
  const { data: msg } = await supabase
    .from('wa_scheduled_messages')
    .select('id, unit_id')
    .eq('id', id)
    .single()

  if (!msg) return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 })

  // Get caller's unit_id from their profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('unit_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.unit_id !== msg.unit_id) {
    return NextResponse.json({ error: 'Sem permissão para cancelar esta mensagem' }, { status: 403 })
  }

  await supabase.from('wa_scheduled_messages').update({ status: 'cancelled' }).eq('id', id)
  return NextResponse.json({ success: true })
}
