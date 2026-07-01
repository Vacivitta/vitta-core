import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST   /api/whatsapp/conversation-tags  { conversation_id, tag_id } — atribui
// DELETE /api/whatsapp/conversation-tags?conversation_id=&tag_id=     — remove

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const body = await req.json() as { conversation_id: string; tag_id: string }
  if (!body.conversation_id || !body.tag_id) {
    return NextResponse.json({ error: 'conversation_id e tag_id são obrigatórios' }, { status: 400 })
  }

  const { error } = await supabase
    .from('wa_conversation_tags')
    .upsert({ conversation_id: body.conversation_id, tag_id: body.tag_id }, { onConflict: 'conversation_id,tag_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const conversationId = req.nextUrl.searchParams.get('conversation_id')
  const tagId          = req.nextUrl.searchParams.get('tag_id')
  if (!conversationId || !tagId) {
    return NextResponse.json({ error: 'conversation_id e tag_id são obrigatórios' }, { status: 400 })
  }

  const { error } = await supabase
    .from('wa_conversation_tags')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('tag_id', tagId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
