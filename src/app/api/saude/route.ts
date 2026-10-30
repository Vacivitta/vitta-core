import { NextRequest, NextResponse } from 'next/server'

// ── GET /api/saude ───────────────────────────────────────────────────────────
//
// Health check do app (Coolify). Pública: liberada no proxy.ts só por este
// caminho exato. Não lê segredo, não toca no WhatsApp e não devolve dado nenhum.
//
//   GET /api/saude           → 200 { status: 'ok' } (liveness: o processo responde)
//   GET /api/saude?pronto=1  → 200 { status: 'ok', supabase: 'ok' } ou 503
//                              (readiness: o Supabase da VPS responde em até 2 s)
//
// O health check do Coolify deve usar a liveness: com a readiness, uma queda curta
// do Supabase faria o Coolify reiniciar o app sem necessidade.

const TIMEOUT_MS = 2000

const SEM_CACHE = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('pronto') !== '1') {
    return NextResponse.json({ status: 'ok' }, { headers: SEM_CACHE })
  }

  // Readiness: health do Auth pelo Kong, com a chave pública (anon) — a mesma que
  // já vai para o navegador. O Auth depende do banco, então isso cobre Kong + Auth + banco.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return NextResponse.json({ status: 'erro', supabase: 'nao_configurado' }, { status: 503, headers: SEM_CACHE })
  }

  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anon },
      cache:   'no-store',
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      return NextResponse.json({ status: 'erro', supabase: `http_${res.status}` }, { status: 503, headers: SEM_CACHE })
    }
    return NextResponse.json({ status: 'ok', supabase: 'ok' }, { headers: SEM_CACHE })
  } catch {
    return NextResponse.json({ status: 'erro', supabase: 'sem_resposta' }, { status: 503, headers: SEM_CACHE })
  }
}
