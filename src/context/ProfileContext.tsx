'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import type { Profile } from '@/types/database'
import { createClient } from '@/lib/supabase/client'

interface ProfileContextValue {
  profile: Profile | null
  isGestor: boolean
  loading: boolean
}

const ProfileContext = createContext<ProfileContextValue>({
  profile: null,
  isGestor: false,
  loading: true,
})

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setLoading(false); return }
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      setProfile((data as Profile) ?? null)
      setLoading(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ProfileContext.Provider value={{ profile, isGestor: profile?.role === 'gestor', loading }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile() {
  return useContext(ProfileContext)
}
