export type LeadStage =
  | 'lead'
  | 'lead_em_interacao'
  | 'reuniao'
  | 'negociacao'
  | 'followup_proposta'
  | 'vendido'
  | 'perdido'

export type ContactRole =
  | 'proprietario'
  | 'secretaria'
  | 'financeiro'
  | 'socio'
  | 'outro'

export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
  created_at: string
}

export interface Lead {
  id: string
  nome: string
  sobrenome: string | null
  profissao: string | null
  cidade: string | null
  estado: string | null
  pais: string | null
  instagram: string | null
  site: string | null
  email: string | null
  telefone: string | null
  stage: LeadStage
  responsavel_id: string | null
  arquivado: boolean
  motivo_perda: string | null
  ordem: number
  created_at: string
  updated_at: string
}

export interface LeadKanban extends Lead {
  responsavel_nome: string | null
  responsavel_avatar: string | null
  valor_proposta: number | null
  modelo: string | null
  valor_negociado: number | null
  tarefas_pendentes: number
  total_notas: number
  total_contatos: number
}

export interface LeadContact {
  id: string
  lead_id: string
  nome: string
  telefone: string | null
  cargo: ContactRole
  observacao: string | null
  created_at: string
}

export interface LeadNote {
  id: string
  lead_id: string
  conteudo: string
  autor_id: string | null
  created_at: string
  autor?: Profile
}

export interface LeadTask {
  id: string
  lead_id: string
  titulo: string
  descricao: string | null
  responsavel_id: string | null
  data_limite: string | null
  lembrete_em: string | null
  concluida: boolean
  created_at: string
  updated_at: string
  responsavel?: Profile
}

export interface LeadNegotiation {
  id: string
  lead_id: string
  valor_proposta: number | null
  modelo: string | null
  valor_negociado: number | null
  updated_at: string
}

export interface LeadResponsibleHistory {
  id: string
  lead_id: string
  responsavel_anterior_id: string | null
  novo_responsavel_id: string | null
  trocado_por_id: string | null
  created_at: string
  responsavel_anterior?: Profile
  novo_responsavel?: Profile
  trocado_por?: Profile
}

export const STAGE_LABELS: Record<LeadStage, string> = {
  lead: 'Lead',
  lead_em_interacao: 'Em Interação',
  reuniao: 'Reunião',
  negociacao: 'Negociação',
  followup_proposta: 'Follow-up',
  vendido: 'Vendido',
  perdido: 'Perdido',
}

export const STAGE_ORDER: LeadStage[] = [
  'lead',
  'lead_em_interacao',
  'reuniao',
  'negociacao',
  'followup_proposta',
  'vendido',
  'perdido',
]

export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  proprietario: 'Proprietário',
  secretaria: 'Secretária',
  financeiro: 'Financeiro',
  socio: 'Sócio',
  outro: 'Outro',
}
