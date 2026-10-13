import type { SupabaseClient } from '@supabase/supabase-js'

/** Perfis que um gestor_unidade pode atribuir. Admin e gestor_vacivitta não têm restrição. */
const GESTOR_UNIDADE_ASSIGNABLE = ['gestor_unidade', 'atendente']

/**
 * Valida se um gestor_unidade pode criar/alterar um usuário com os dados informados.
 * Impede escalonamento de privilégio: o gestor só atribui perfis de nível igual ou
 * inferior ao seu e só vincula usuários às unidades que ele mesmo gerencia.
 *
 * @param admin - Cliente service-role (para ler user_units/profiles sem RLS)
 * @param callerId - ID do gestor_unidade que está fazendo a chamada
 * @param opts.perfil - Perfil a ser atribuído (se estiver sendo alterado)
 * @param opts.unitIds - Unidades a vincular ao usuário (se estiverem sendo alteradas)
 * @param opts.targetId - ID do usuário alvo (em edições); deve compartilhar unidade com o gestor
 * @returns Mensagem de erro, ou `null` se a operação é permitida
 */
export async function checkGestorUnidadeScope(
  admin: SupabaseClient,
  callerId: string,
  opts: { perfil?: unknown; unitIds?: string[]; targetId?: string },
): Promise<string | null> {
  if (opts.perfil !== undefined && !GESTOR_UNIDADE_ASSIGNABLE.includes(opts.perfil as string)) {
    return 'Gestor de unidade só pode atribuir os perfis gestor_unidade ou atendente'
  }

  const { data: callerUnits } = await admin.from('user_units').select('unit_id').eq('user_id', callerId)
  const allowed = new Set((callerUnits ?? []).map(u => u.unit_id as string))

  if (opts.unitIds && opts.unitIds.some(u => !allowed.has(u))) {
    return 'Gestor de unidade só pode vincular usuários às suas próprias unidades'
  }

  if (opts.targetId) {
    if (opts.targetId === callerId && opts.perfil !== undefined) {
      return 'Não é possível alterar o próprio perfil'
    }
    const [{ data: target }, { data: targetUnits }] = await Promise.all([
      admin.from('profiles').select('perfil').eq('id', opts.targetId).maybeSingle(),
      admin.from('user_units').select('unit_id').eq('user_id', opts.targetId),
    ])
    if (target && !GESTOR_UNIDADE_ASSIGNABLE.includes(target.perfil as string)) {
      return 'Sem permissão para alterar este usuário'
    }
    if (!(targetUnits ?? []).some(u => allowed.has(u.unit_id as string))) {
      return 'Sem permissão para alterar usuários de outra unidade'
    }
  }

  return null
}
