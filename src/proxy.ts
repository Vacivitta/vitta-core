import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { MIGRACAO_VPS_URL, PAGINA_MANUTENCAO } from '@/lib/migracao'

const PUBLIC_PATHS = [
  '/login',
  '/termos',
  '/privacidade',
  '/auth/callback',
  '/auth/reset-password',
  '/orcamento/ver',
  '/api/orcamento/respond',
  '/api/orcamento/check-expiring', // cron (pg_cron) — a rota valida o CRON_SECRET
  '/api/whatsapp',
]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Troca para a VPS: na Vercel só o webhook da Meta passa (é repassado à VPS)
  if (MIGRACAO_VPS_URL && !pathname.startsWith('/api/whatsapp/webhook')) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Sistema em manutenção' }, { status: 503 })
    }
    return new NextResponse(PAGINA_MANUTENCAO, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '120' },
    })
  }

  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))
  if (isPublic) return NextResponse.next({ request })

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
