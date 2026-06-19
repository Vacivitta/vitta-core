import { redirect }    from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CampanhasClient  from './CampanhasClient'
import type { Profile }  from '@/types/database'

export const metadata = { title: 'Campanhas — Vitta Core' }

export interface CampaignRow {
  id:                 string
  nome:               string
  template_nome:      string | null
  template_category:  string
  status:             string
  scheduled_at:       string | null
  started_at:         string | null
  completed_at:       string | null
  daily_limit:        number
  total_recipients:   number
  sent_count:         number
  delivered_count:    number
  read_count:         number
  replied_count:      number
  optout_count:       number
  failed_count:       number
  estimated_cost_usd: number
  actual_cost_usd:    number
  created_at:         string
}

export interface TemplateRow {
  id:             string
  name:           string
  content:        string
  category:       string
  template_name:  string | null
  language:       string | null
}

export interface FunnelStageRow {
  id:        string
  nome:      string
  funnel_id: string
  funnel:    { id: string; nome: string } | null
}

export default async function CampanhasPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')
  if (profile.perfil === 'atendente') redirect('/funil')

  const [
    { data: campaigns },
    { data: templates },
    { data: stages },
  ] = await Promise.all([
    supabase
      .from('wa_campaigns')
      .select('id,nome,template_nome,template_category,status,scheduled_at,started_at,completed_at,daily_limit,total_recipients,sent_count,delivered_count,read_count,replied_count,optout_count,failed_count,estimated_cost_usd,actual_cost_usd,created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('wa_message_templates')
      .select('id,name,content,category,template_name,language')
      .eq('ativo', true)
      .order('name'),
    supabase
      .from('funnel_stages')
      .select('id,nome,funnel_id,funnels(id,nome)')
      .order('funnel_id').order('ordem'),
  ])

  return (
    <CampanhasClient
      currentUser={profile as Profile}
      initialCampaigns={(campaigns ?? []) as CampaignRow[]}
      templates={(templates ?? []) as TemplateRow[]}
      stages={(stages ?? []).map(s => ({
        ...s,
        funnel: Array.isArray(s.funnels) ? (s.funnels[0] ?? null) : s.funnels,
      })) as FunnelStageRow[]}
    />
  )
}
