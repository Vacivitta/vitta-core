'use client'

import { useEffect, useRef, useState } from 'react'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  width?: number
  children: React.ReactNode
  footer?: React.ReactNode
}

export default function Drawer({ open, onClose, title, width = 440, children, footer }: DrawerProps) {
  const [visible, setVisible] = useState(false)
  const [animIn, setAnimIn]   = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setVisible(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimIn(true)))
    } else {
      setAnimIn(false)
      const t = setTimeout(() => setVisible(false), 220)
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!visible) return null

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', justifyContent: 'flex-end',
        background: animIn ? 'rgba(37,64,44,0.35)' : 'rgba(37,64,44,0)',
        transition: 'background 0.2s ease',
      }}
    >
      <div
        ref={panelRef}
        style={{
          width, maxWidth: '100vw', height: '100%',
          display: 'flex', flexDirection: 'column',
          background: '#fff',
          borderRadius: '22px 0 0 22px',
          boxShadow: '-30px 0 70px -30px rgba(37,64,44,0.5)',
          transform: animIn ? 'translateX(0)' : 'translateX(60px)',
          opacity: animIn ? 1 : 0,
          transition: 'transform 0.25s cubic-bezier(0.16,1,0.3,1), opacity 0.2s ease',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px', flexShrink: 0,
          borderBottom: '1px solid #EFECE0',
        }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#25402C' }}>{title}</span>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 10, border: 'none',
              background: '#F2EEE1', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#71856F', transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#EBE7DA')}
            onMouseLeave={e => (e.currentTarget.style.background = '#F2EEE1')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{
            padding: '14px 24px', flexShrink: 0,
            borderTop: '1px solid #EFECE0',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
