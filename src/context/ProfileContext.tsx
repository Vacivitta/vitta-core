'use client'

import { createContext, useContext, useState, useEffect, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Profile, UserPerfil, Unit } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { unidadeDaAba } from '@/lib/unidade-ativa'
import {
  escreverCookieDaUnidade, gravarUnidadeDaAba, lerCookieDaUnidade, lerUnidadeDaAba,
} from '@/lib/unidade-ativa-navegador'

interface ProfileContextValue {
  profile:      Profile | null
  perfil:       UserPerfil | null
  isGestor:     boolean
  isAdmin:      boolean
  loading:      boolean
  units:        Unit[]
  /** Unidade ativa desta aba (sessionStorage + cookie vd_unidade); profiles.unit_id guarda só a última usada. */
  activeUnitId: string | null
  /** Conta as trocas de unidade nesta aba: o conteúdo da página remonta a cada troca. */
  versaoUnidade: number
  /** Troca a unidade desta aba sem recarregar; com destino, abre essa página. */
  switchUnit:   (unitId: string, destino?: string) => Promise<void>
}

const ProfileContext = createContext<ProfileContextValue>({
  profile:      null,
  perfil:       null,
  isGestor:     false,
  isAdmin:      false,
  loading:      true,
  units:        [],
  activeUnitId: null,
  versaoUnidade: 0,
  switchUnit:   async () => {},
})

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const router   = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [units, setUnits]     = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [versaoUnidade, setVersaoUnidade] = useState(0)
  const [, iniciarTransicao] = useTransition()

  useEffect(() => {
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setLoading(false); return }

      const [{ data: prof }, { data: userUnits }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('user_units').select('unit_id').eq('user_id', user.id),
      ])

      if (prof) {
        const unitIds = (userUnits ?? []).map(u => u.unit_id as string)
        const cookie = lerCookieDaUnidade()
        const ativa = unidadeDaAba(lerUnidadeDaAba() ?? cookie, (prof as Profile).unit_id, unitIds)
        setProfile({ ...(prof as Profile), unit_id: ativa })
        if (ativa) {
          gravarUnidadeDaAba(ativa)
          // O servidor desenhou com o cookie de outra aba: desenha de novo com a desta
          if (ativa !== cookie) router.refresh()
        }
        if (unitIds.length > 0) {
          const { data: unitRows } = await supabase
            .from('units')
            .select('*')
            .in('id', unitIds)
            .order('nome')
          setUnits((unitRows as Unit[]) ?? [])
        }
      }
      setLoading(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const unidadeAtual = profile?.unit_id ?? null
  useEffect(() => {
    if (!unidadeAtual) return
    const aoVoltar = () => { if (document.visibilityState === 'visible') escreverCookieDaUnidade(unidadeAtual) }
    window.addEventListener('focus', aoVoltar)
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      window.removeEventListener('focus', aoVoltar)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [unidadeAtual])

  const switchUnit = useCallback(async (unitId: string, destino?: string) => {
    if (!profile || !units.some(u => u.id === unitId)) return
    // Última unidade usada: é com ela que uma aba nova e o próximo login começam
    const { error } = await supabase.from('profiles').update({ unit_id: unitId }).eq('id', profile.id)
    if (error) console.error('[switchUnit] última unidade não gravada:', error.message)
    gravarUnidadeDaAba(unitId)
    iniciarTransicao(() => {
      setProfile(prev => prev ? { ...prev, unit_id: unitId } : prev)
      setVersaoUnidade(v => v + 1)
      if (destino) router.push(destino)
      else router.refresh()
    })
  }, [profile, units, supabase, router])

  const perfil       = profile?.perfil ?? null
  const isGestor     = perfil !== null && perfil !== 'atendente'
  const isAdmin      = perfil === 'admin'
  const activeUnitId = profile?.unit_id ?? null

  return (
    <ProfileContext.Provider value={{ profile, perfil, isGestor, isAdmin, loading, units, activeUnitId, versaoUnidade, switchUnit }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile() {
  return useContext(ProfileContext)
}
