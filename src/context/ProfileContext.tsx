'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { Profile, UserPerfil, Unit } from '@/types/database'
import { createClient } from '@/lib/supabase/client'

interface ProfileContextValue {
  profile:      Profile | null
  perfil:       UserPerfil | null
  isGestor:     boolean
  isAdmin:      boolean
  loading:      boolean
  units:        Unit[]
  activeUnitId: string | null
  switchUnit:   (unitId: string) => Promise<void>
}

const ProfileContext = createContext<ProfileContextValue>({
  profile:      null,
  perfil:       null,
  isGestor:     false,
  isAdmin:      false,
  loading:      true,
  units:        [],
  activeUnitId: null,
  switchUnit:   async () => {},
})

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [units, setUnits]     = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setLoading(false); return }

      const [{ data: prof }, { data: userUnits }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('user_units').select('unit_id').eq('user_id', user.id),
      ])

      if (prof) {
        setProfile(prof as Profile)
        const unitIds = (userUnits ?? []).map(u => u.unit_id)
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

  const switchUnit = useCallback(async (unitId: string) => {
    if (!profile) return
    const { error } = await supabase
      .from('profiles')
      .update({ unit_id: unitId })
      .eq('id', profile.id)
    if (error) { console.error('[switchUnit]', error.message); return }
    setProfile(prev => prev ? { ...prev, unit_id: unitId } : prev)
    window.location.reload()
  }, [profile, supabase])

  const perfil       = profile?.perfil ?? null
  const isGestor     = perfil !== null && perfil !== 'atendente'
  const isAdmin      = perfil === 'admin'
  const activeUnitId = profile?.unit_id ?? null

  return (
    <ProfileContext.Provider value={{ profile, perfil, isGestor, isAdmin, loading, units, activeUnitId, switchUnit }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile() {
  return useContext(ProfileContext)
}
