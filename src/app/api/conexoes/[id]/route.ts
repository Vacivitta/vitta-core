import { NextRequest, NextResponse } from 'next/server'
import { podeGerenciarConexao } from '@/lib/conexoes'
import { adminConexoes, quemPede } from '@/lib/conexoes-servidor'
import { apagarInstancia, ErroEvolution, estadoDaInstancia, qrCodeDaInstancia } from '@/lib/whatsapp/evolution'
import { statusDaConexao } from '@/lib/whatsapp/evolution-webhook'
import { resumoErro } from '@/lib/log-seguro'

interface ConexaoQr { id: string; unit_id: string; tipo: string; pessoal: boolean; dona_id: string | null; instancia: string | null; status: string; ativo: boolean }

async function carregar(id: string) {
  const admin = adminConexoes()
  const { data } = await admin.from('conexoes')
    .select('id, unit_id, tipo, pessoal, dona_id, instancia, status, ativo')
    .eq('id', id).maybeSingle<ConexaoQr>()
  if (!data) return { erro: NextResponse.json({ error: 'Conexão não encontrada' }, { status: 404 }) }
  const quem = await quemPede(data.unit_id)
  if (!quem) return { erro: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }) }
  if (!podeGerenciarConexao(quem, data)) return { erro: NextResponse.json({ error: 'Sem permissão para esta conexão' }, { status: 403 }) }
  return { admin, conexao: data }
}

// GET — status atual e, se ainda não conectada, o QR Code para ler no celular
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await carregar(id)
  if ('erro' in r) return r.erro
  const { admin, conexao } = r
  if (!conexao.ativo || !conexao.instancia) return NextResponse.json({ status: 'desconectada', qr: null })

  try {
    const status = statusDaConexao(await estadoDaInstancia(conexao.instancia)) ?? conexao.status
    if (status !== conexao.status) await admin.from('conexoes').update({ status }).eq('id', conexao.id)
    if (status === 'conectada') return NextResponse.json({ status, qr: null })
    return NextResponse.json({ status: 'aguardando_qr', qr: await qrCodeDaInstancia(conexao.instancia) })
  } catch (e) {
    console.error(`[conexões] estado ${conexao.id}:`, e instanceof ErroEvolution ? e.message : resumoErro(e))
    return NextResponse.json({ error: 'O conector de QR Code não respondeu' }, { status: 502 })
  }
}

// DELETE — desconecta o número e apaga a sessão. Sem conversas, a conexão some;
// com conversas, fica inativa (o histórico continua no Atendimento).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await carregar(id)
  if ('erro' in r) return r.erro
  const { admin, conexao } = r

  if (conexao.instancia) {
    try {
      await apagarInstancia(conexao.instancia)
    } catch (e) {
      // 404: a instância já não existe na Evolution; segue para limpar aqui
      if (!(e instanceof ErroEvolution && e.status === 404)) {
        console.error(`[conexões] apagar ${conexao.id}:`, e instanceof ErroEvolution ? e.message : resumoErro(e))
        return NextResponse.json({ error: 'O conector de QR Code não respondeu' }, { status: 502 })
      }
    }
  }
  const { count } = await admin.from('wa_conversations').select('id', { count: 'exact', head: true }).eq('conexao_id', conexao.id)
  const { error } = count
    ? await admin.from('conexoes').update({ ativo: false, status: 'desconectada', instancia: null }).eq('id', conexao.id)
    : await admin.from('conexoes').delete().eq('id', conexao.id)
  if (error) {
    console.error(`[conexões] remover ${conexao.id}:`, resumoErro(error))
    return NextResponse.json({ error: 'Erro ao remover a conexão' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, inativa: !!count })
}
