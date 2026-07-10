import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { id } = await req.json() as { id?: string }
  if (!id) return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 })

  const admin = createAdminClient()

  const { data: lead } = await admin.from('leads').select('id, unit_id').eq('id', id).single()
  if (!lead) return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })

  const { data: profile } = await admin.from('profiles').select('unit_id').eq('id', user.id).single()
  if (profile?.unit_id !== lead.unit_id) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { count } = await admin.from('quotes').select('id', { count: 'exact', head: true }).eq('lead_id', id)
  if (count && count > 0) {
    return NextResponse.json({ error: `Este cliente possui ${count} orçamento(s) vinculado(s). Remova os orçamentos antes de excluir.` }, { status: 409 })
  }

  const { error } = await admin.from('leads').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
