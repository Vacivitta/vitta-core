import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAccessibleLead } from '@/lib/auth/access'
import {
  ANEXOS_BUCKET, ANEXO_ERRO_TAMANHO, ANEXO_ERRO_TIPO, ANEXO_ERRO_VAZIO, ANEXO_TAMANHO_MAXIMO,
  detectarTipoAnexo, nomeComExtensao, nomeParaCaminho, prefixoAnexos, sanitizarNomeArquivo,
} from '@/lib/anexos'
import { resumoErro } from '@/lib/log-seguro'

// Folga para os cabeçalhos do multipart além do arquivo
const CORPO_MAXIMO = ANEXO_TAMANHO_MAXIMO + 64 * 1024

/**
 * Anexa um arquivo à ficha do lead (bucket privado lead-anexos, migração 128).
 *
 * POST /api/leads/[id]/anexos
 * Body: multipart/form-data com o campo `arquivo`
 * Resposta 201: { anexo } | { error: string }
 * Qualquer perfil que veja o lead (RLS de leads). O tipo é conferido pela
 * assinatura do arquivo, não pelo MIME do navegador.
 * Erros: 401, 404 (lead), 400 (sem arquivo / vazio), 413 (> 20 MB), 415 (tipo), 409 (lead mudou de unidade), 500
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const lead = await getAccessibleLead(supabase, id)
  if (!lead) return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })

  const tamanhoCorpo = Number(req.headers.get('content-length') ?? 0)
  if (tamanhoCorpo > CORPO_MAXIMO) return NextResponse.json({ error: ANEXO_ERRO_TAMANHO }, { status: 413 })

  let arquivo: FormDataEntryValue | null
  try {
    arquivo = (await req.formData()).get('arquivo')
  } catch {
    return NextResponse.json({ error: 'Não foi possível ler o arquivo enviado' }, { status: 400 })
  }
  if (!(arquivo instanceof File)) return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 })
  if (arquivo.size === 0) return NextResponse.json({ error: ANEXO_ERRO_VAZIO }, { status: 400 })
  if (arquivo.size > ANEXO_TAMANHO_MAXIMO) return NextResponse.json({ error: ANEXO_ERRO_TAMANHO }, { status: 413 })

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const tipo = detectarTipoAnexo(bytes)
  if (!tipo) return NextResponse.json({ error: ANEXO_ERRO_TIPO }, { status: 415 })

  const nome = nomeComExtensao(sanitizarNomeArquivo(arquivo.name), tipo)
  const caminho = `${prefixoAnexos(lead.unit_id, lead.id)}${crypto.randomUUID()}-${nomeParaCaminho(nome)}`

  const admin = createAdminClient()
  const { error: upErr } = await admin.storage
    .from(ANEXOS_BUCKET)
    .upload(caminho, bytes, { contentType: tipo, upsert: false })
  if (upErr) {
    console.error('[leads/anexos] upload falhou:', resumoErro(upErr))
    return NextResponse.json({ error: 'Não foi possível guardar o arquivo. Tente de novo.' }, { status: 500 })
  }

  const { data: anexo, error: insErr } = await admin
    .from('lead_anexos')
    .insert({ lead_id: lead.id, unit_id: lead.unit_id, caminho, nome, mime: tipo, tamanho: bytes.length, enviado_por: user.id })
    .select('id, lead_id, unit_id, nome, mime, tamanho, enviado_por, criado_em, autor:profiles!enviado_por(full_name)')
    .single()
  if (insErr || !anexo) {
    await admin.storage.from(ANEXOS_BUCKET).remove([caminho])
    // 23514: o lead foi transferido entre a leitura e o insert (trigger da 128)
    if (insErr?.code === '23514') {
      return NextResponse.json({ error: 'O lead mudou de unidade. Reabra a ficha e envie de novo.' }, { status: 409 })
    }
    console.error('[leads/anexos] registrar anexo falhou:', resumoErro(insErr))
    return NextResponse.json({ error: 'Não foi possível registrar o anexo. Tente de novo.' }, { status: 500 })
  }

  return NextResponse.json({ anexo }, { status: 201 })
}
