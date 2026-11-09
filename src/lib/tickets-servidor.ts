import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { modulosLigados } from '@/lib/modulos'
import type { Modulo } from '@/types/database'
import type { FunilDeTicket } from '@/components/tickets/NovoTicketModal'

export interface DadosDeTicket {
  modulos:  Set<Modulo>
  funis:    FunilDeTicket[]
  pessoas:  { id: string; nome: string }[]
  empresas: { id: string; nome: string }[]
}

/** Início da janela dos resolvidos que a tela de Tickets mostra (30 dias). */
export function inicioDosResolvidos(): string {
  return new Date(Date.now() - 30 * 86400_000).toISOString()
}

/**
 * O que a tela precisa para abrir e editar tickets numa unidade: módulos ligados,
 * funis de ticket com as etapas, pessoas da unidade e empresas (se o módulo
 * Empresas estiver ligado). Lê com o cliente do usuário (RLS), menos as pessoas: a
 * regra de user_units só mostra os vínculos do próprio usuário, então os membros
 * da unidade (id e nome) vêm do service role. Quem chama já validou a unidade
 * (buscarPerfil só aceita unidade vinculada).
 */
export async function dadosDeTicket(supabase: SupabaseClient, unitId: string): Promise<DadosDeTicket> {
  const [{ data: excecoes }, { data: funis }, { data: vinculos }] = await Promise.all([
    supabase.from('unidade_modulos').select('modulo, ativo').eq('unit_id', unitId),
    supabase.from('funnels').select('id, nome, ordem, funnel_stages(id, nome, ordem)')
      .eq('unit_id', unitId).eq('objeto', 'ticket').eq('ativo', true).order('ordem'),
    createAdminClient().from('user_units').select('user_id').eq('unit_id', unitId).eq('ativo', true),
  ])
  const modulos = modulosLigados(excecoes ?? [])
  const ids = (vinculos ?? []).map(v => v.user_id as string)
  const [{ data: perfis }, { data: empresas }] = await Promise.all([
    ids.length ? createAdminClient().from('profiles').select('id, full_name, apelido').in('id', ids).eq('ativo', true).order('full_name')
               : Promise.resolve({ data: [] as { id: string; full_name: string | null; apelido: string | null }[] }),
    modulos.has('empresas') ? supabase.from('empresas').select('id, nome').eq('unit_id', unitId).order('nome')
                            : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
  ])
  return {
    modulos,
    funis: (funis ?? []).map(f => ({
      id: f.id as string,
      nome: f.nome as string,
      etapas: ((f.funnel_stages ?? []) as { id: string; nome: string; ordem: number }[]),
    })),
    pessoas: (perfis ?? []).map(p => ({ id: p.id as string, nome: (p.apelido as string | null) || (p.full_name as string | null) || 'Sem nome' })),
    empresas: (empresas ?? []).map(e => ({ id: e.id as string, nome: e.nome as string })),
  }
}
