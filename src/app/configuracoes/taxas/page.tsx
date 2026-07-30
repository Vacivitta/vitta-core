import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TaxasClient from './TaxasClient'
import type { Profile, UnitPaymentFees } from '@/types/database'

export const metadata = { title: 'Taxas de Pagamento — VittaDesk' }

export default async function TaxasPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profileData) redirect('/login')

  const profile = profileData as Profile

  if (profile.perfil !== 'admin' && profile.perfil !== 'gestor_unidade' && profile.perfil !== 'gestor_vacivitta') {
    redirect('/funil')
  }

  const { data: feesData } = await supabase
    .from('unit_payment_fees')
    .select('*')
    .eq('unit_id', profile.unit_id)
    .single()

  return (
    <TaxasClient
      unitId={profile.unit_id!}
      initialFees={(feesData as UnitPaymentFees) ?? null}
    />
  )
}
