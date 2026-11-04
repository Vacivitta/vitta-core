import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAccessibleLead } from '@/lib/auth/access'

// POST   /api/leads/tags  { lead_id, tag_id }  — aplica a tag no lead
// DELETE /api/leads/tags?lead_id=&tag_id=      — remove
// Grava com o client do usuário: o RLS de lead_tags (migração 127) e o trigger que
// recusa tag de outra unidade são a regra; a checagem do lead aqui só dá o 404.

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const body = await req.json().catch(() => null) as { lead_id?: unknown; tag_id?: unknown } | null
  const leadId = typeof body?.lead_id === 'string' ? body.lead_id : ''
  const tagId  = typeof body?.tag_id === 'string' ? body.tag_id : ''
  if (!leadId || !tagId) {
    return NextResponse.json({ error: 'lead_id e tag_id são obrigatórios' }, { status: 400 })
  }

  if (!await getAccessibleLead(supabase, leadId)) {
    return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })
  }

  const { error } = await supabase
    .from('lead_tags')
    .upsert({ lead_id: leadId, tag_id: tagId }, { onConflict: 'lead_id,tag_id', ignoreDuplicates: true })

  if (error) {
    // 23514: tag de outra unidade (trigger da 127)
    if (error.code === '23514') return NextResponse.json({ error: 'Tag de outra unidade' }, { status: 400 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const leadId = req.nextUrl.searchParams.get('lead_id')
  const tagId  = req.nextUrl.searchParams.get('tag_id')
  if (!leadId || !tagId) {
    return NextResponse.json({ error: 'lead_id e tag_id são obrigatórios' }, { status: 400 })
  }

  if (!await getAccessibleLead(supabase, leadId)) {
    return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })
  }

  const { error } = await supabase
    .from('lead_tags')
    .delete()
    .eq('lead_id', leadId)
    .eq('tag_id', tagId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
