'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type View = 'login' | 'forgot' | 'forgot-sent'

export default function LoginPage() {
  const [view, setView]         = useState<View>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Vitta Core</h1>
          <p className="text-sm text-gray-500 mt-1">CRM Comercial</p>
        </div>

        {view === 'login' && (
          <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="seu@email.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-500 text-white font-medium rounded-xl text-sm hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
            <button
              type="button"
              onClick={() => { setView('forgot'); setError('') }}
              className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors pt-1"
            >
              Esqueceu a senha?
            </button>
          </form>
        )}

        {view === 'forgot' && (
          <form onSubmit={handleForgot} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
            <div>
              <p className="text-sm text-gray-600 mb-3">
                Informe seu e-mail e enviaremos um link para redefinir sua senha.
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="seu@email.com"
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-500 text-white font-medium rounded-xl text-sm hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Enviando...' : 'Enviar link de recuperação'}
            </button>
            <button
              type="button"
              onClick={resetView}
              className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors pt-1"
            >
              Voltar ao login
            </button>
          </form>
        )}

        {view === 'forgot-sent' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Link enviado!</p>
              <p className="text-sm text-gray-500 mt-1">
                Verifique sua caixa de entrada em <span className="font-medium">{email}</span> e clique no link para redefinir sua senha.
              </p>
            </div>
            <button
              type="button"
              onClick={resetView}
              className="w-full py-2.5 border border-gray-200 text-gray-600 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
            >
              Voltar ao login
            </button>
          </div>
        )}
      <p className="text-center text-xs text-gray-400 mt-8">
        <a href="/termos" className="hover:text-gray-500 transition-colors">Termos de Uso</a>
        <span className="mx-2">·</span>
        <a href="/privacidade" className="hover:text-gray-500 transition-colors">Política de Privacidade</a>
      </p>
      </div>
    </div>
  )
}
