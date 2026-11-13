import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { interpretarMensagemQr, previaDaMensagem, statusDaConexao, webhookEvolutionAutorizado, type MensagemQr } from '@/lib/whatsapp/evolution-webhook'
import { buscarConversaPorTelefone } from '@/lib/whatsapp/telefone'
import { nomeDoGrupo, receberGrupos } from '@/lib/whatsapp/evolution'
import { resumoErro } from '@/lib/log-seguro'

// Webhook do conector de QR Code (Evolution API, ADR 0002). Fora da sessão (proxy
// libera /api/whatsapp*): só passa com o JWT que a Evolution assina com
// EVOLUTION_WEBHOOK_SECRET. A conexão é achada pela instância; evento de
// instância desconhecida é ignorado.
//
// Eventos: messages.upsert (conversa individual ou de grupo, com o autor),
// connection.update (status da conexão; queda avisa a dona ou a unidade) e
// qrcode.updated (aguardando leitura). Mensagens do QR Code não criam lead nem
// disparam automação: o número pode ser pessoal (ADR 0007) e o contato só vira
// lead por ação do atendente; o trigger da conversa ainda liga um lead que já
// existe com o mesmo telefone.

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[QR webhook] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  return createClient(url, key)
}

interface Conexao { id: string; unit_id: string; status: string; pessoal: boolean; dona_id: string | null; nome: string; instancia: string }

interface EventoEvolution { event?: string; instance?: string; data?: unknown }

export async function POST(req: NextRequest) {
  if (!webhookEvolutionAutorizado(req.headers.get('authorization'), process.env.EVOLUTION_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  let evento: EventoEvolution
  try {
    evento = await req.json() as EventoEvolution
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  if (!evento.instance) return NextResponse.json({ ok: true })

  const supabase = adminClient()
  const { data: conexao } = await supabase
    .from('conexoes')
    .select('id, unit_id, status, pessoal, dona_id, nome, instancia')
    .eq('instancia', evento.instance)
    .eq('tipo', 'qrcode')
    .maybeSingle<Conexao>()
  if (!conexao) {
    console.warn('[QR webhook] instância sem conexão no VittaDesk — ignorada')
    return NextResponse.json({ ok: true })
  }

  try {
    switch (evento.event) {
      case 'connection.update':
        await atualizarStatus(supabase, conexao, evento.data as { state?: string; wuid?: string })
        break
      case 'qrcode.updated':
        if (conexao.status !== 'conectada') {
          await supabase.from('conexoes').update({ status: 'aguardando_qr' }).eq('id', conexao.id)
        }
        break
      case 'messages.upsert': {
        const lista = Array.isArray(evento.data) ? evento.data : [evento.data]
        for (const dados of lista) {
          const mensagem = interpretarMensagemQr(dados as Parameters<typeof interpretarMensagemQr>[0])
          if (mensagem) await gravarMensagem(supabase, conexao, mensagem)
        }
        break
      }
    }
  } catch (e) {
    console.error(`[QR webhook] erro no evento ${evento.event} conexão=${conexao.id}:`, resumoErro(e))
    return NextResponse.json({ error: 'Erro ao processar' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

async function atualizarStatus(supabase: SupabaseClient, conexao: Conexao, dados: { state?: string; wuid?: string } | undefined) {
  const status = statusDaConexao(dados?.state)
  if (!status || status === conexao.status) return

  // Instância criada antes da entrega 3 nascia ignorando grupos
  if (status === 'conectada') {
    await receberGrupos(conexao.instancia).catch(e => console.error('[QR webhook] ligar grupos:', resumoErro(e)))
  }

  const numero = dados?.wuid?.split('@')[0]?.replace(/\D/g, '')
  await supabase.from('conexoes')
    .update({ status, ...(status === 'conectada' && numero ? { numero: `+${numero}` } : {}) })
    .eq('id', conexao.id)

  // Caiu depois de conectada: a dona (conexão pessoal) ou a unidade lê o QR de novo
  if (status === 'desconectada' && conexao.status === 'conectada') {
    const { error } = await supabase.from('notifications').insert({
      unit_id: conexao.unit_id,
      user_id: conexao.pessoal ? conexao.dona_id : null,
      type:    'conexao_caiu',
      title:   `WhatsApp desconectado: ${conexao.nome}`,
      body:    'Leia o QR Code de novo em Configurações › Conexões.',
    })
    if (error) console.error('[QR webhook] aviso de conexão caída:', resumoErro(error))
  }
}

const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'application/pdf': 'pdf',
}

async function guardarMidia(supabase: SupabaseClient, unitId: string, m: MensagemQr): Promise<string | null> {
  if (!m.midia) return null
  const ext = EXTENSOES[m.midia.mimetype] ?? m.midia.nomeArquivo?.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'bin'
  const caminho = `${unitId}/qr-${m.id.replace(/[^A-Za-z0-9_-]/g, '')}.${ext}`
  const { error } = await supabase.storage
    .from('wa-media')
    .upload(caminho, Buffer.from(m.midia.base64, 'base64'), { contentType: m.midia.mimetype, upsert: true })
  if (error) {
    console.error('[QR webhook] upload de mídia falhou:', error.message)
    return null
  }
  return supabase.storage.from('wa-media').getPublicUrl(caminho).data.publicUrl
}

async function buscarGrupo(supabase: SupabaseClient, conexaoId: string, grupoId: string) {
  const { data } = await supabase
    .from('wa_conversations')
    .select('id, lead_id, wa_phone, profile_picture_url')
    .eq('conexao_id', conexaoId)
    .eq('wa_phone', grupoId)
    .maybeSingle()
  return data
}

async function gravarMensagem(supabase: SupabaseClient, conexao: Conexao, m: MensagemQr) {
  let conversa = m.grupo
    ? await buscarGrupo(supabase, conexao.id, m.telefone)
    : await buscarConversaPorTelefone(supabase, conexao.id, m.telefone)
  if (!conversa) {
    // Grupo: o nome vem da Evolution; sem ele, a lista mostra o id do grupo
    const nome = m.grupo
      ? await nomeDoGrupo(conexao.instancia, m.telefone).catch(() => null)
      : (m.deMim ? null : m.nome)
    const { data, error } = await supabase
      .from('wa_conversations')
      .upsert(
        { unit_id: conexao.unit_id, conexao_id: conexao.id, wa_phone: m.telefone, tipo: m.grupo ? 'grupo' : 'individual', wa_contact_name: nome },
        { onConflict: 'conexao_id,wa_phone', ignoreDuplicates: false },
      )
      .select('id, lead_id, wa_phone, profile_picture_url')
      .maybeSingle()
    if (error || !data) throw error ?? new Error('conversa não criada')
    conversa = data
  }

  const { data: nova, error: msgErr } = await supabase
    .from('wa_messages')
    .upsert(
      {
        conversation_id: conversa.id,
        unit_id:         conexao.unit_id,
        wa_message_id:   m.id,
        direction:       m.deMim ? 'outbound' : 'inbound',
        type:            m.tipo === 'sticker' ? 'image' : m.tipo,
        content:         m.texto,
        media_url:       await guardarMidia(supabase, conexao.unit_id, m),
        media_mime_type: m.midia?.mimetype ?? null,
        status:          m.deMim ? 'sent' : 'delivered',
        autor_telefone:  m.autor?.telefone ?? null,
        autor_nome:      m.autor?.nome ?? null,
      },
      { onConflict: 'wa_message_id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()
  if (msgErr) throw msgErr
  // Já gravada: a mensagem enviada pelo VittaDesk volta da Evolution como fromMe
  if (!nova) return

  const agora = new Date().toISOString()
  if (m.deMim) {
    await supabase.from('wa_conversations')
      .update({ last_message_at: agora, last_message_content: previaDaMensagem(m), last_message_direction: 'outbound', unread_count: 0 })
      .eq('id', conversa.id)
    return
  }
  await supabase.from('wa_conversations')
    .update({
      last_message_at: agora, status: 'open', last_message_content: previaDaMensagem(m), last_message_direction: 'inbound',
      ...(m.nome && !m.grupo ? { wa_contact_name: m.nome } : {}),
    })
    .eq('id', conversa.id)
  const { error: unreadErr } = await supabase.rpc('increment_wa_unread', { p_conversation_id: conversa.id })
  if (unreadErr) console.error('[QR webhook] increment_wa_unread:', unreadErr.message)
}
