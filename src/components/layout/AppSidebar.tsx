'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/hooks/useProfile'
import { PERFIL_LABELS } from '@/types/database'
import NotificationBell from './NotificationBell'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    href: '/funil',
    label: 'Funil',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
      </svg>
    ),
  },
  {
    href: '/atendimento',
    label: 'Atendimento',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    href: '/agenda',
    label: 'Agenda',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
]

const CATALOGO_ITEM: NavItem = {
  href: '/produtos',
  label: 'Catálogo',
  icon: (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>
  ),
}

const ORCAMENTOS_ITEM: NavItem = {
  href: '/orcamento',
  label: 'Orçamentos',
  icon: (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
}

const BOTTOM_ITEMS: NavItem[] = [
  {
    href: '/configuracoes/funis',
    label: 'Configurações',
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

const SUPERVISAO_ITEM: NavItem = {
  href: '/supervisao',
  label: 'Supervisão',
  icon: (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
}

function NavLink({ item, collapsed, active }: { item: NavItem; collapsed: boolean; active: boolean }) {
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={`flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors text-sm font-medium ${
        active
          ? 'bg-blue-50 text-blue-700'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      {item.icon}
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )
}

export default function AppSidebar() {
  const pathname   = usePathname()
  const router     = useRouter()
  const supabase   = createClient()
  const { profile, perfil, isGestor } = useProfile()

  const [collapsed, setCollapsed] = useState(false)

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const isActive   = (href: string) => pathname.startsWith(href)
  const userName   = profile?.full_name ?? ''
  const initial    = userName ? userName[0].toUpperCase() : '?'
  const roleColor  = isGestor ? 'bg-purple-100' : 'bg-blue-100'
  const roleText   = isGestor ? 'text-purple-600' : 'text-blue-600'
  const perfilLabel = perfil ? PERFIL_LABELS[perfil] : null

  return (
    <aside
      className={`relative flex flex-col bg-white border-r border-gray-200 shrink-0 transition-all duration-200 ease-in-out ${
        collapsed ? 'w-14' : 'w-52'
      }`}
    >
      {/* Logo + toggle */}
      <div className={`flex items-center border-b border-gray-100 shrink-0 h-14 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
        {!collapsed && (
          <span className="text-sm font-bold text-gray-900 truncate">Vitta Core</span>
        )}
        <button
          onClick={() => setCollapsed(v => !v)}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map(item => (
          <NavLink key={item.href} item={item} collapsed={collapsed} active={isActive(item.href)} />
        ))}

        {/* Catálogo de vacinas */}
        <NavLink item={CATALOGO_ITEM} collapsed={collapsed} active={isActive(CATALOGO_ITEM.href)} />

        {/* Orçamentos */}
        <NavLink item={ORCAMENTOS_ITEM} collapsed={collapsed} active={isActive(ORCAMENTOS_ITEM.href)} />

        {/* Supervisão — gestors only */}
        {isGestor && (
          <Link
            href={SUPERVISAO_ITEM.href}
            title={collapsed ? SUPERVISAO_ITEM.label : undefined}
            className={`flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors text-sm font-medium ${
              isActive(SUPERVISAO_ITEM.href)
                ? 'bg-purple-50 text-purple-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            {SUPERVISAO_ITEM.icon}
            {!collapsed && <span className="truncate">{SUPERVISAO_ITEM.label}</span>}
          </Link>
        )}
      </nav>

      {/* Bottom section */}
      <div className="px-2 pb-3 space-y-0.5 border-t border-gray-100 pt-2 shrink-0">
        {BOTTOM_ITEMS.map(item => (
          <NavLink key={item.href} item={item} collapsed={collapsed} active={isActive(item.href)} />
        ))}

        {/* Templates PDF — gestors only */}
        {isGestor && (
          <NavLink
            item={{
              href: '/configuracoes/templates',
              label: 'Templates PDF',
              icon: (
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              ),
            }}
            collapsed={collapsed}
            active={isActive('/configuracoes/templates')}
          />
        )}

        {/* Notificações */}
        <NotificationBell collapsed={collapsed} />

        {/* Automações — gestors only */}
        {isGestor && (
          <NavLink
            item={{
              href: '/configuracoes/automacoes',
              label: 'Automações',
              icon: (
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              ),
            }}
            collapsed={collapsed}
            active={isActive('/configuracoes/automacoes')}
          />
        )}

        {/* User + logout */}
        <div className={`flex items-center mt-1 ${collapsed ? 'justify-center' : 'gap-2 px-2.5 py-2'}`}>
          <div
            className={`w-7 h-7 rounded-full ${roleColor} flex items-center justify-center shrink-0 cursor-default`}
            title={collapsed ? (userName || 'Usuário') : undefined}
          >
            <span className={`text-[11px] font-bold ${roleText}`}>{initial}</span>
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-gray-700 truncate block">{userName || 'Usuário'}</span>
                {perfilLabel && (
                  <span className={`text-[10px] font-medium ${isGestor ? 'text-purple-500' : 'text-emerald-500'}`}>
                    {perfilLabel}
                  </span>
                )}
              </div>
              <button
                onClick={handleLogout}
                title="Sair"
                className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </>
          )}
        </div>
        {collapsed && (
          <button
            onClick={handleLogout}
            title="Sair"
            className="flex items-center justify-center w-full py-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        )}
      </div>
    </aside>
  )
}
