import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { nomeDaInstancia, podeCriarConexao } from '@/lib/conexoes'
import { adminConexoes, quemPede } from '@/lib/conexoes-servidor'
import { configEvolution, criarInstancia, ErroEvolution } from '@/lib/whatsapp/evolution'
import { resumoErro } from '@/lib/log-seguro'

// POST { unit_id, nome, pessoal } — cria uma conexão por QR Code e devolve o QR.
// Pessoal: o número de quem pede (ADR 0007); da unidade: só gestor.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { unit_id?: string; nome?: string; pessoal?: boolean } | null
  const unitId = body?.unit_id
  const nome = body?.nome?.trim()
  const pessoal = body?.pessoal === true
  if (!unitId || !nome) return NextResponse.json({ error: 'unit_id e nome obrigatórios' }, { status: 400 })
  if (nome.length > 60) return NextResponse.json({ error: 'Nome com no máximo 60 caracteres' }, { status: 400 })

  const quem = await quemPede(unitId)
  if (!quem) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  if (!podeCriarConexao(quem, pessoal)) return NextResponse.json({ error: 'Sem permissão para criar esta conexão' }, { status: 403 })
  if (!configEvolution()) return NextResponse.json({ error: 'Conector de QR Code não configurado neste ambiente' }, { status: 503 })

  const admin = adminConexoes()
  const id = randomUUID()
  const instancia = nomeDaInstancia(id)
  const { error } = await admin.from('conexoes').insert({
    id, unit_id: unitId, tipo: 'qrcode', nome, pessoal, dona_id: pessoal ? quem.userId : null, instancia, status: 'aguardando_qr',
  })
  if (error) {
    console.error('[conexões] criar:', resumoErro(error))
    return NextResponse.json({ error: 'Erro ao criar a conexão' }, { status: 500 })
  }

  try {
    const qr = await criarInstancia(instancia)
    return NextResponse.json({ id, qr })
  } catch (e) {
    await admin.from('conexoes').delete().eq('id', id)
    console.error('[conexões] criar instância:', e instanceof ErroEvolution ? e.message : resumoErro(e))
    return NextResponse.json({ error: 'O conector de QR Code não respondeu. Tente de novo.' }, { status: 502 })
  }
}
