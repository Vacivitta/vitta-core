'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type View = 'login' | 'forgot' | 'forgot-sent'

export default function LoginPage() {
  const [view, setView]         = useState<View>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [remember, setRemember] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const router   = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('E-mail ou senha incorretos.')
      setLoading(false)
    } else {
      router.push('/funil')
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const redirectTo = `${window.location.origin}/auth/callback?next=/auth/reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    setLoading(false)
    if (error) {
      setError('Não foi possível enviar o e-mail. Verifique o endereço e tente novamente.')
    } else {
      setView('forgot-sent')
    }
  }

  function resetView() {
    setView('login')
    setError('')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', overflow: 'hidden', background: '#F4FAFE' }}>

      {/* ── Left panel (desktop only) ──────────────────────────────── */}
      <div
        className="hidden lg:flex"
        style={{
          flex: '0 0 50%',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
          background: 'linear-gradient(150deg, #F4FAFE 0%, #E9F5FC 48%, #DCEFFA 100%)',
          padding: '48px 56px',
          overflow: 'hidden',
        }}
      >
        {/* Decorative heart watermarks */}
        <svg
          style={{ position: 'absolute', top: -40, right: -40, opacity: 0.07, pointerEvents: 'none' }}
          width="320" height="320" viewBox="0 0 320 320" fill="none"
        >
          <path
            d="M160 280C160 280 24 196 24 108C24 64.6 58.6 30 102 30C124.4 30 144.6 40.2 160 56.8C175.4 40.2 195.6 30 218 30C261.4 30 296 64.6 296 108C296 196 160 280 160 280Z"
            fill="#0098DA"
          />
        </svg>
        <svg
          style={{ position: 'absolute', bottom: -60, left: -60, opacity: 0.05, pointerEvents: 'none' }}
          width="380" height="380" viewBox="0 0 380 380" fill="none"
        >
          <path
            d="M190 340C190 340 28 236 28 128C28 76.6 70.6 36 122 36C148 36 172 47.8 190 67.4C208 47.8 232 36 258 36C309.4 36 352 76.6 352 128C352 236 190 340 190 340Z"
            fill="#0098DA"
          />
        </svg>

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 40, alignSelf: 'flex-start' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-vacivitta-sidebar.svg"
            alt="VittaDesk"
            style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0 }}
          />
          <span style={{ fontSize: 20, fontWeight: 800, color: '#0E2C3D', letterSpacing: '-0.01em' }}>
            VittaDesk
          </span>
        </div>

        {/* Headline */}
        <div style={{ alignSelf: 'flex-start', marginBottom: 48 }}>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: '#0E2C3D', lineHeight: 1.2, margin: 0, letterSpacing: '-0.02em' }}>
            Gerencie sua clínica<br />com clareza
          </h2>
          <p style={{ fontSize: 15, color: '#5B7A8A', marginTop: 12, lineHeight: 1.6 }}>
            Funil de vendas, orçamentos e agenda<br />em um só lugar.
          </p>
        </div>

        {/* Floating cards */}
        <div style={{ position: 'relative', width: '100%', height: 220 }}>

          {/* Card 1 — Próxima Aplicação */}
          <div
            className="float-card"
            style={{
              position: 'absolute',
              left: 8,
              top: 0,
              width: 300,
              background: '#fff',
              borderRadius: 16,
              padding: '16px 20px',
              boxShadow: '0 8px 24px -8px rgba(14,44,61,0.14)',
              animationDelay: '0s',
            }}
          >
            <p style={{ fontSize: 10, fontWeight: 700, color: '#0098DA', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
              Próxima aplicação
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#EAF6FC', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0098DA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#0E2C3D', margin: 0 }}>Ana Beatriz</p>
                <p style={{ fontSize: 12, color: '#8A98A6', margin: 0 }}>HPV 2ª dose</p>
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#4EB46B', background: '#E9F7EE', borderRadius: 99, padding: '3px 9px' }}>
                  Hoje
                </span>
              </div>
            </div>
          </div>

          {/* Card 2 — Taxa de Conversão */}
          <div
            className="float-card"
            style={{
              position: 'absolute',
              right: 0,
              top: 90,
              width: 220,
              background: '#fff',
              borderRadius: 16,
              padding: '16px 20px',
              boxShadow: '0 8px 24px -8px rgba(14,44,61,0.14)',
              animationDelay: '1.2s',
            }}
          >
            <p style={{ fontSize: 10, fontWeight: 700, color: '#8A98A6', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
              Taxa de conversão
            </p>
            <p style={{ fontSize: 28, fontWeight: 800, color: '#0E2C3D', margin: '8px 0 10px' }}>
              65<span style={{ fontSize: 16 }}>%</span>
            </p>
            <div style={{ background: '#F0F3F6', borderRadius: 99, height: 6, overflow: 'hidden' }}>
              <div style={{ width: '65%', height: '100%', background: 'linear-gradient(90deg, #0098DA, #54B3E6)', borderRadius: 99 }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel — form ─────────────────────────────────────── */}
      <div
        style={{
          flex: '1 1 50%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: '#fff',
          padding: '40px 24px',
          minHeight: '100vh',
          overflowY: 'auto',
        }}
      >
        {/* Mobile-only logo */}
        <div className="flex lg:hidden" style={{ flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-vacivitta-login.svg" alt="VittaDesk" style={{ width: 72, height: 66, marginBottom: 8 }} />
          <span style={{ fontSize: 20, fontWeight: 800, color: '#0E2C3D', letterSpacing: '-0.01em' }}>VittaDesk</span>
        </div>

        <div style={{ width: '100%', maxWidth: 392 }}>

          {/* ─ Login view ─ */}
          {view === 'login' && (
            <>
              <div style={{ marginBottom: 32 }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0E2C3D', margin: 0, letterSpacing: '-0.01em' }}>
                  Login do Operador
                </h1>
                <p style={{ fontSize: 14, color: '#8A98A6', marginTop: 6 }}>
                  Acesse sua conta para continuar
                </p>
              </div>

              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Email */}
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#3F5666', marginBottom: 6 }}>
                    E-mail
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A98A6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder="seu@email.com"
                      style={{
                        width: '100%',
                        paddingLeft: 40,
                        paddingRight: 14,
                        paddingTop: 11,
                        paddingBottom: 11,
                        fontSize: 14,
                        border: '1.5px solid #E1EEF7',
                        borderRadius: 10,
                        outline: 'none',
                        color: '#0E2C3D',
                        background: '#FBFDFF',
                        transition: 'border-color 0.15s',
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = '#0098DA' }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#E1EEF7' }}
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#3F5666', marginBottom: 6 }}>
                    Senha
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A98A6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <input
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      style={{
                        width: '100%',
                        paddingLeft: 40,
                        paddingRight: 42,
                        paddingTop: 11,
                        paddingBottom: 11,
                        fontSize: 14,
                        border: '1.5px solid #E1EEF7',
                        borderRadius: 10,
                        outline: 'none',
                        color: '#0E2C3D',
                        background: '#FBFDFF',
                        transition: 'border-color 0.15s',
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = '#0098DA' }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#E1EEF7' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(v => !v)}
                      style={{
                        position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#8A98A6',
                      }}
                      tabIndex={-1}
                    >
                      {showPwd ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                          <line x1="2" x2="22" y1="2" y2="22" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Remember + Forgot */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#3F5666' }}>
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={e => setRemember(e.target.checked)}
                      style={{ width: 15, height: 15, accentColor: '#0098DA', cursor: 'pointer' }}
                    />
                    Lembrar de mim
                  </label>
                  <button
                    type="button"
                    onClick={() => { setView('forgot'); setError('') }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#0098DA', fontWeight: 500, padding: 0 }}
                  >
                    Esqueceu a senha?
                  </button>
                </div>

                {error && (
                  <p style={{ fontSize: 13, color: '#E5484D', background: '#FDEBEC', borderRadius: 8, padding: '10px 14px', margin: 0 }}>
                    {error}
                  </p>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '13px 0',
                    background: loading ? '#9DB6C7' : 'linear-gradient(135deg, #0098DA 0%, #006FA3 100%)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 15,
                    border: 'none',
                    borderRadius: 10,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    boxShadow: loading ? 'none' : '0 6px 16px -6px rgba(0,152,218,0.55)',
                    transition: 'background 0.15s, box-shadow 0.15s',
                    letterSpacing: '0.01em',
                  }}
                >
                  {loading ? 'Entrando...' : 'Entrar'}
                </button>


              </form>
            </>
          )}

          {/* ─ Forgot view ─ */}
          {view === 'forgot' && (
            <>
              <div style={{ marginBottom: 32 }}>
                <button
                  type="button"
                  onClick={resetView}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#8A98A6', fontSize: 13, padding: 0, marginBottom: 20 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                  Voltar ao login
                </button>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0E2C3D', margin: 0, letterSpacing: '-0.01em' }}>
                  Recuperar senha
                </h1>
                <p style={{ fontSize: 14, color: '#8A98A6', marginTop: 6 }}>
                  Informe seu e-mail e enviaremos um link para redefinir sua senha.
                </p>
              </div>

              <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#3F5666', marginBottom: 6 }}>
                    E-mail
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A98A6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder="seu@email.com"
                      style={{
                        width: '100%',
                        paddingLeft: 40,
                        paddingRight: 14,
                        paddingTop: 11,
                        paddingBottom: 11,
                        fontSize: 14,
                        border: '1.5px solid #E1EEF7',
                        borderRadius: 10,
                        outline: 'none',
                        color: '#0E2C3D',
                        background: '#FBFDFF',
                        transition: 'border-color 0.15s',
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = '#0098DA' }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#E1EEF7' }}
                    />
                  </div>
                </div>

                {error && (
                  <p style={{ fontSize: 13, color: '#E5484D', background: '#FDEBEC', borderRadius: 8, padding: '10px 14px', margin: 0 }}>
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '13px 0',
                    background: loading ? '#9DB6C7' : 'linear-gradient(135deg, #0098DA 0%, #006FA3 100%)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 15,
                    border: 'none',
                    borderRadius: 10,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    boxShadow: loading ? 'none' : '0 6px 16px -6px rgba(0,152,218,0.55)',
                    transition: 'background 0.15s, box-shadow 0.15s',
                  }}
                >
                  {loading ? 'Enviando...' : 'Enviar link de recuperação'}
                </button>
              </form>
            </>
          )}

          {/* ─ Forgot-sent view ─ */}
          {view === 'forgot-sent' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#E9F7EE', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4EB46B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0E2C3D', margin: 0 }}>Link enviado!</h2>
              <p style={{ fontSize: 14, color: '#8A98A6', marginTop: 8, lineHeight: 1.6 }}>
                Verifique sua caixa de entrada em{' '}
                <strong style={{ color: '#3F5666' }}>{email}</strong>{' '}
                e clique no link para redefinir sua senha.
              </p>
              <button
                type="button"
                onClick={resetView}
                style={{
                  marginTop: 24,
                  width: '100%',
                  padding: '13px 0',
                  background: 'none',
                  color: '#0098DA',
                  fontWeight: 700,
                  fontSize: 15,
                  border: '1.5px solid #E1EEF7',
                  borderRadius: 10,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
              >
                Voltar ao login
              </button>
            </div>
          )}

          {/* Footer links */}
          <p style={{ textAlign: 'center', fontSize: 12, color: '#9DB6C7', marginTop: 36 }}>
            <a href="/termos" style={{ color: 'inherit', textDecoration: 'none' }}>Termos de Uso</a>
            <span style={{ margin: '0 8px' }}>·</span>
            <a href="/privacidade" style={{ color: 'inherit', textDecoration: 'none' }}>Política de Privacidade</a>
          </p>

        </div>
      </div>
    </div>
  )
}
