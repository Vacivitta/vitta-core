import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isPerfilGestor } from '@/lib/auth/access'
import ImportarClient, { type FunilImportacao } from './ImportarClient'
import type { CampoLead, TipoTag } from '@/types/database'
import { buscarPerfil } from '@/lib/supabase/perfil'

export const metadata = { title: 'Importar contatos — VittaDesk' }

export default async function ImportarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await buscarPerfil(supabase, user.id, 'unit_id, perfil')
  if (!profile) redirect('/login')
  // Importar é gestão (a rota confere de novo)
  if (!isPerfilGestor(profile.perfil)) redirect('/clientes')
  const unitId = profile.unit_id as string | null
  if (!unitId) redirect('/clientes')

  const [{ data: funis }, { data: etapas }, { data: perfis }, { data: vinculos }, { data: campos }, { data: tags }] =
    await Promise.all([
      supabase.from('funnels').select('id, nome').eq('unit_id', unitId).eq('ativo', true).order('ordem'),
      supabase.from('funnel_stages').select('id, funnel_id, nome, ordem, resultado, campos_obrigatorios').eq('unit_id', unitId).order('ordem'),
      supabase.from('profiles').select('id, full_name').eq('unit_id', unitId).order('full_name'),
      supabase.from('user_units').select('user_id').eq('unit_id', unitId).eq('ativo', true),
      supabase.from('campos_lead').select('*').eq('unit_id', unitId).eq('ativo', true).order('ordem').order('rotulo'),
      supabase.from('wa_tags').select('id, name, tipo').eq('unit_id', unitId).eq('tipo', 'lead').order('name'),
    ])

  let responsaveis = (perfis ?? []) as { id: string; full_name: string | null }[]
  const extras = (vinculos ?? []).map(v => v.user_id as string).filter(id => !responsaveis.some(p => p.id === id))
  if (extras.length > 0) {
    const { data } = await supabase.from('profiles').select('id, full_name').in('id', extras).order('full_name')
    responsaveis = [...responsaveis, ...((data ?? []) as typeof responsaveis)]
  }

  const funisComEtapas: FunilImportacao[] = (funis ?? []).map(f => ({
    id:     f.id as string,
    nome:   f.nome as string,
    // Etapa com resultado mudaria o status ao inserir; a rota também recusa
    etapas: (etapas ?? [])
      .filter(e => e.funnel_id === f.id && !e.resultado)
      .map(e => ({ id: e.id as string, nome: e.nome as string, exigidos: (e.campos_obrigatorios ?? []) as string[] })),
  }))

  return (
    <ImportarClient
      unitId={unitId}
      funis={funisComEtapas}
      responsaveis={responsaveis.map(p => ({ id: p.id, nome: p.full_name ?? 'Sem nome' }))}
      campos={(campos ?? []) as CampoLead[]}
      tags={(tags ?? []) as { id: string; name: string; tipo: TipoTag }[]}
    />
  )
}
