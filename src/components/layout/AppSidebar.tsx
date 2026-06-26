'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/hooks/useProfile'
import { PERFIL_LABELS } from '@/types/database'
import NotificationBell from './NotificationBell'

// ── Ícones Lucide (stroke 2, 18px) ───────────────────────────────────────────

const IcoDashboard = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/>
    <rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>
  </svg>
)

const IcoFunil = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M8 7v7M12 7v10M16 7v4"/>
  </svg>
)

const IcoAtendimento = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
)

const IcoAgenda = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <path d="M16 2v4M8 2v4M3 10h18"/>
  </svg>
)

const IcoTarefas = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
    <rect x="9" y="3" width="6" height="4" rx="1"/>
    <path d="m9 12 2 2 4-4"/>
  </svg>
)

const IcoClientes = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.2"/>
    <path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 0 0 0-6M21 20a5 5 0 0 0-4-4.9"/>
  </svg>
)

const IcoCatalogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2v6.5L4.2 17a2 2 0 0 0 1.8 3h12a2 2 0 0 0 1.8-3L15 8.5V2M8 2h8M7 14h10"/>
  </svg>
)

const IcoOrcamento = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <path d="M14 2v6h6M8 13h8M8 17h5"/>
  </svg>
)

const IcoSupervisao = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

const IcoSettings = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

const IcoChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

const IcoLogout = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
)

// Sub-ícones configurações
const IcoFunis = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
)
const IcoTemplates = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
  </svg>
)
const IcoEquipe = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)
const IcoAutomacoes = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
)
const IcoFilas = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M22 11H16M19 8v6"/>
  </svg>
)
const IcoTemplatesWa = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    <path d="M8 10h8M8 14h5"/>
  </svg>
)
const IcoWhatsApp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>
  </svg>
)

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface NavItem {
  href:  string
  label: string
  icon:  React.ReactNode
}

// ── Itens de navegação principal ──────────────────────────────────────────────

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',  label: 'Dashboard',   icon: <IcoDashboard /> },
  { href: '/funil',      label: 'Funil',        icon: <IcoFunil /> },
  { href: '/atendimento',label: 'Atendimento',  icon: <IcoAtendimento /> },
  { href: '/agenda',     label: 'Agenda',       icon: <IcoAgenda /> },
  { href: '/tarefas',    label: 'Tarefas',      icon: <IcoTarefas /> },
  { href: '/clientes',   label: 'Clientes',     icon: <IcoClientes /> },
  { href: '/produtos',   label: 'Catálogo',     icon: <IcoCatalogo /> },
  { href: '/orcamento',  label: 'Orçamentos',   icon: <IcoOrcamento /> },
]

const CONFIG_ITEMS = [
  { href: '/configuracoes/funis',               label: 'Funis',             icon: <IcoFunis />,        gestorOnly: false },
  { href: '/configuracoes/filas',               label: 'Filas',             icon: <IcoFilas />,        gestorOnly: true  },
  { href: '/configuracoes/templates',           label: 'Templates PDF',     icon: <IcoTemplates />,    gestorOnly: true  },
  { href: '/configuracoes/templates-whatsapp',  label: 'Templates WhatsApp',icon: <IcoTemplatesWa />,  gestorOnly: true  },
  { href: '/configuracoes/whatsapp',            label: 'WhatsApp API',      icon: <IcoWhatsApp />,     gestorOnly: true  },
  { href: '/configuracoes/equipe',              label: 'Equipe',            icon: <IcoEquipe />,       gestorOnly: true  },
  { href: '/configuracoes/automacoes',          label: 'Automações',        icon: <IcoAutomacoes />,   gestorOnly: true  },
]

const CONFIG_HREFS = CONFIG_ITEMS.map(i => i.href)

// ── Componente NavLink ────────────────────────────────────────────────────────

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:           '12px',
        padding:       '11px 13px',
        borderRadius:  '12px',
        fontSize:      '14px',
        fontWeight:    600,
        textDecoration:'none',
        transition:    'background 0.15s, color 0.15s',
        ...(active
          ? { background: '#0098DA', color: '#fff', boxShadow: '0 6px 16px -6px rgba(0,152,218,.6)' }
          : { color: '#3F5666' }
        ),
      }}
      className={!active ? 'nav-item-idle' : ''}
    >
      {item.icon}
      <span style={{ flex: 1 }}>{item.label}</span>
    </Link>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function AppSidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()
  const { profile, perfil, isGestor } = useProfile()

  const [configOpen, setConfigOpen] = useState(() =>
    CONFIG_HREFS.some(h => pathname.startsWith(h))
  )

  const isActive     = (href: string) => pathname.startsWith(href)
  const isConfigActive = CONFIG_HREFS.some(h => isActive(h))

  const userName    = profile?.full_name ?? ''
  const userEmail   = (profile as any)?.email ?? ''
  const initials    = userName
    .split(' ')
    .slice(0, 2)
    .map((w: string) => w[0])
    .join('')
    .toUpperCase() || '?'
  const perfilLabel = perfil ? PERFIL_LABELS[perfil] : 'Admin'

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Hover idle: injetado via <style> para evitar prop inline repetida */}
      <style>{`.nav-item-idle:hover { background: #E8F3FB; }`}</style>

      <aside style={{
        width:          '248px',
        flexShrink:     0,
        display:        'flex',
        flexDirection:  'column',
        height:         '100%',
        background:     '#F4FAFE',
        borderRight:    '1px solid #E1EEF7',
        padding:        '20px 14px 14px',
        overflow:       'hidden',
      }}>

        {/* ── Logo ──────────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', marginBottom: '22px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-vacivitta-sidebar.svg"
            alt="VittaDesk"
            style={{ width: '40px', height: '40px', flexShrink: 0, borderRadius: '11px' }}
          />
          <span style={{ fontSize: '17px', fontWeight: 800, color: '#0E2C3D', letterSpacing: '-0.01em' }}>
            VittaDesk
          </span>
        </div>

        {/* ── Nav principal ──────────────────────────────────────────────────── */}
        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto' }}>
          {NAV_ITEMS.map(item => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}

          {/* Supervisão — gestores only */}
          {isGestor && (
            <Link
              href="/supervisao"
              style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '11px 13px', borderRadius: '12px',
                fontSize: '14px', fontWeight: 600, textDecoration: 'none',
                transition: 'background 0.15s, color 0.15s',
                ...(isActive('/supervisao')
                  ? { background: '#0098DA', color: '#fff', boxShadow: '0 6px 16px -6px rgba(0,152,218,.6)' }
                  : { color: '#3F5666' }
                ),
              }}
              className={!isActive('/supervisao') ? 'nav-item-idle' : ''}
            >
              <IcoSupervisao />
              <span style={{ flex: 1 }}>Supervisão</span>
            </Link>
          )}
        </nav>

        {/* ── Rodapé ────────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '8px', borderTop: '1px solid #E1EEF7', paddingTop: '10px' }}>

          {/* Notificações */}
          <NotificationBell />

          {/* Configurações com submenu */}
          <div>
            <button
              onClick={() => setConfigOpen(v => !v)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
                padding: '11px 13px', borderRadius: '12px',
                fontSize: '14px', fontWeight: 600, border: 'none', cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
                background: isConfigActive ? '#EAF6FC' : 'transparent',
                color:      isConfigActive ? '#0098DA'  : '#3F5666',
              }}
              className={!isConfigActive ? 'nav-item-idle' : ''}
            >
              <IcoSettings />
              <span style={{ flex: 1, textAlign: 'left' }}>Configurações</span>
              <span style={{
                transition: 'transform 0.2s',
                transform:  configOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                color: '#8A98A6',
              }}>
                <IcoChevronDown />
              </span>
            </button>

            {configOpen && (
              <div style={{ marginLeft: '14px', paddingLeft: '10px', borderLeft: '1px solid #E1EEF7', marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                {CONFIG_ITEMS.filter(i => !i.gestorOnly || isGestor).map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '8px 10px', borderRadius: '10px',
                      fontSize: '13px', fontWeight: isActive(item.href) ? 600 : 500,
                      textDecoration: 'none', transition: 'background 0.15s',
                      background: isActive(item.href) ? '#EAF6FC' : 'transparent',
                      color:      isActive(item.href) ? '#0098DA'  : '#8A98A6',
                    }}
                    className={!isActive(item.href) ? 'nav-item-idle' : ''}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Card do usuário */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 10px', marginTop: '4px', borderRadius: '12px',
          }}>
            {/* Avatar */}
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #0098DA, #54B3E6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#fff' }}>{initials}</span>
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#0E2C3D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {userName || 'Usuário'}
              </div>
              <div style={{ fontSize: '11px', color: '#0098DA', fontWeight: 600 }}>
                {perfilLabel ?? 'Admin'}
              </div>
            </div>

            {/* Logout */}
            <button
              onClick={handleLogout}
              title="Sair"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#8A98A6', padding: '4px', borderRadius: '6px',
                display: 'flex', alignItems: 'center', transition: 'color 0.15s',
                flexShrink: 0,
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#3F5666')}
              onMouseLeave={e => (e.currentTarget.style.color = '#8A98A6')}
            >
              <IcoLogout />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
