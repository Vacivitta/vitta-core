'use client'

import { Fragment } from 'react'
import { usePathname } from 'next/navigation'
import AppSidebar from './AppSidebar'
import TaskReminder from '@/components/agenda/TaskReminder'

import { ProfileProvider, useProfile } from '@/context/ProfileContext'

const PUBLIC_PATHS = ['/login', '/orcamento/ver/', '/termos', '/privacidade']

/** Remonta a página quando a aba troca de unidade, para os componentes recarregarem os dados dela. */
function ConteudoDaUnidade({ children }: { children: React.ReactNode }) {
  const { versaoUnidade } = useProfile()
  return <Fragment key={versaoUnidade}>{children}</Fragment>
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))

  if (isPublic) return <>{children}</>

  return (
    <ProfileProvider>
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg-app)' }}>
        <AppSidebar />
        <div className="flex-1 flex flex-col overflow-y-auto min-w-0">
          <ConteudoDaUnidade>{children}</ConteudoDaUnidade>
        </div>
        <TaskReminder />
      </div>
    </ProfileProvider>
  )
}
