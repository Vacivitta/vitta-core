import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('perfil').eq('id', user.id).single()

  if (profile?.perfil !== 'admin')
    return NextResponse.json({ error: 'Apenas admins podem criar unidades' }, { status: 403 })

  const body = await req.json() as {
    nome: string; cidade?: string; estado?: string; telefone?: string; tenant_id: string
  }

  if (!body.nome?.trim() || !body.tenant_id)
    return NextResponse.json({ error: 'Nome e tenant_id obrigatórios' }, { status: 400 })

  const { data: unit, error } = await admin
    .from('units')
    .insert({
      tenant_id: body.tenant_id,
      nome:      body.nome.trim(),
      cidade:    body.cidade?.trim() || null,
      estado:    body.estado?.trim() || null,
      telefone:  body.telefone?.trim() || null,
    })
    .select()
    .single()

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  // Vincula o admin à nova unidade
  await admin.from('user_units').insert({ user_id: user.id, unit_id: unit.id })

  return NextResponse.json(unit)
}
