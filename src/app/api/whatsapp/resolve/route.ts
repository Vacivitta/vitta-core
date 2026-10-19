import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runWaAutomation } from '@/lib/whatsapp/automation'

// ── POST /api/whatsapp/resolve ────────────────────────────────────────────────
//
// Body: { conversation_id: string, reason?: string, note?: string }
//
// Marca a conversa como resolvida e dispara a automação `conversation_resolved`
// (ex.: mover o lead para Finalizados). A automação precisa do service-role,
// por isso a resolução passa pelo servidor em vez de um update direto do navegador.
//
export async function POST(req: NextRequest) {
  const userClient = await createServerClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { conversation_id, reason, note } = await req.json().catch(() => ({})) as {
    conversation_id?: string; reason?: string; note?: string
  }
  if (!conversation_id) return NextResponse.json({ error: 'conversation_id obrigatório' }, { status: 400 })

  // RLS garante que o usuário pertence à unidade da conversa
  const { data: conv } = await userClient
    .from('wa_conversations')
    .select('id, unit_id')
    .eq('id', conversation_id)
    .maybeSingle()
  if (!conv) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('wa_conversations')
    .update({
      status:          'resolved',
      resolved_reason: reason ?? null,
      resolved_note:   note?.trim() || null,
      resolved_at:     new Date().toISOString(),
    })
    .eq('id', conversation_id)

  if (error) {
    console.error('[WA resolve] erro ao resolver conversa:', error.message)
    return NextResponse.json({ error: 'Não foi possível resolver a conversa' }, { status: 500 })
  }

  try {
    await runWaAutomation(admin, 'conversation_resolved', conv.unit_id, conversation_id)
  } catch (e) {
    console.error('[WA resolve] automação conversation_resolved falhou:', e)
  }

  return NextResponse.json({ ok: true })
}
