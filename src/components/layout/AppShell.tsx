'use client'

import { usePathname } from 'next/navigation'
import AppSidebar from './AppSidebar'
import TaskReminder from '@/components/agenda/TaskReminder'

import { ProfileProvider } from '@/context/ProfileContext'

const PUBLIC_PATHS = ['/login', '/orcamento/ver/', '/termos', '/privacidade']

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))

  if (isPublic) return <>{children}</>

  return (
    <ProfileProvider>
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg-app)' }}>
        <AppSidebar />
        <div className="flex-1 flex flex-col overflow-y-auto min-w-0">
          {children}
        </div>
        <TaskReminder />
      </div>
    </ProfileProvider>
  )
}
