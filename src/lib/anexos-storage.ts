import type { SupabaseClient } from '@supabase/supabase-js'
import { ANEXOS_BUCKET, prefixoAnexos } from '@/lib/anexos'
import { resumoErro } from '@/lib/log-seguro'

// Os caminhos têm o nome do arquivo, que pode ter nome de paciente: nunca vão para o log.

/**
 * Apaga do storage todos os arquivos de um lead: os registrados em lead_anexos
 * (o caminho é a fonte da verdade; depois de mesclar, o prefixo é o do lead
 * removido) e qualquer sobra no prefixo atual. Chamar antes de apagar o lead:
 * o ON DELETE CASCADE leva as linhas, mas não os objetos.
 *
 * @param admin - Client service-role
 * @returns `true` se tudo foi apagado (ou não havia nada)
 */
export async function removerArquivosDoLead(admin: SupabaseClient, leadId: string, unitId: string): Promise<boolean> {
  const { data: linhas, error } = await admin.from('lead_anexos').select('caminho').eq('lead_id', leadId)
  if (error) {
    console.error('[anexos] listar anexos do lead falhou:', resumoErro(error))
    return false
  }
  const caminhos = new Set((linhas ?? []).map(l => l.caminho as string))

  const prefixo = prefixoAnexos(unitId, leadId)
  for (let offset = 0; ; offset += 1000) {
    const { data: objetos, error: listErr } = await admin.storage
      .from(ANEXOS_BUCKET)
      .list(prefixo.slice(0, -1), { limit: 1000, offset })
    if (listErr) {
      console.error('[anexos] listar prefixo do lead falhou:', resumoErro(listErr))
      return false
    }
    for (const o of objetos ?? []) caminhos.add(prefixo + o.name)
    if (!objetos || objetos.length < 1000) break
  }

  const lista = [...caminhos]
  for (let i = 0; i < lista.length; i += 100) {
    const { error: rmErr } = await admin.storage.from(ANEXOS_BUCKET).remove(lista.slice(i, i + 100))
    if (rmErr) {
      console.error('[anexos] remover arquivos do lead falhou:', resumoErro(rmErr))
      return false
    }
  }
  return true
}

/**
 * Move os arquivos de um lead transferido para o prefixo da unidade nova e
 * atualiza `caminho`. O unit_id das linhas já mudou junto com o lead (trigger
 * da 128). Se mover um arquivo falhar, a linha fica com o caminho antigo, que
 * continua válido (abrir e excluir usam `caminho`); só a organização por
 * unidade no bucket fica incompleta.
 *
 * @param admin - Client service-role
 * @returns Quantos arquivos não puderam ser movidos
 */
export async function moverArquivosDoLead(admin: SupabaseClient, leadId: string, unitIdNova: string): Promise<number> {
  const { data: linhas, error } = await admin.from('lead_anexos').select('id, caminho').eq('lead_id', leadId)
  if (error) {
    console.error('[anexos] listar anexos para transferir falhou:', resumoErro(error))
    return -1
  }
  const prefixoNovo = prefixoAnexos(unitIdNova, leadId)
  let falhas = 0
  for (const l of linhas ?? []) {
    const caminho = l.caminho as string
    if (caminho.startsWith(prefixoNovo)) continue
    const destino = prefixoNovo + caminho.split('/').pop()
    const { error: mvErr } = await admin.storage.from(ANEXOS_BUCKET).move(caminho, destino)
    if (mvErr) {
      console.error('[anexos] mover arquivo na transferência falhou:', resumoErro(mvErr))
      falhas++
      continue
    }
    const { error: upErr } = await admin.from('lead_anexos').update({ caminho: destino }).eq('id', l.id)
    if (upErr) {
      // O objeto já está no destino: sem a linha atualizada ele ficaria inacessível
      const { error: voltaErr } = await admin.storage.from(ANEXOS_BUCKET).move(destino, caminho)
      console.error('[anexos] atualizar caminho falhou:', resumoErro(upErr), voltaErr ? `(desfazer: ${resumoErro(voltaErr)})` : '')
      falhas++
    }
  }
  return falhas
}
