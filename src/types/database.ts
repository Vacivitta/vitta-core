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
  role: 'gestor' | 'operador'
  created_at: string
}

// ---- Chat interno ----------------------------------------------------------

export interface InternalMessage {
  id: string
  de_id: string
  para_id: string
  conteudo: string
  lido: boolean
  created_at: string
}

// ---- Funis ----------------------------------------------------------------

export interface Funnel {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  ordem: number
  created_at: string
}

export interface FunnelStage {
  id: string
  funnel_id: string
  nome: string
  cor: string
  ordem: number
  alerta_horas: number | null
  created_at: string
}

export interface FunnelWithStages extends Funnel {
  stages: FunnelStage[]
}

// ---- Leads ----------------------------------------------------------------

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
  origem: string | null
  funnel_id: string
  stage_id: string
  responsavel_id: string | null
  arquivado: boolean
  motivo_perda: string | null
  ordem: number
  stage_changed_at: string
  created_at: string
  updated_at: string
}

export interface LeadKanban extends Lead {
  responsavel_nome: string | null
  responsavel_avatar: string | null
  stage_nome: string | null
  stage_cor: string | null
  stage_ordem: number | null
  funnel_nome: string | null
  valor_proposta: number | null
  modelo: string | null
  valor_negociado: number | null
  stage_alerta_horas: number | null
  tarefas_pendentes: number
  total_notas: number
  total_contatos: number
}

// ---- Relacionamentos -------------------------------------------------------

export interface LeadContact {
  id: string
  lead_id: string
  nome: string
  telefone: string | null
  email: string | null
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
  editado_em: string | null
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

// ---- Constantes estáticas --------------------------------------------------

export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  proprietario: 'Proprietário',
  secretaria:   'Secretária',
  financeiro:   'Financeiro',
  socio:        'Sócio',
  outro:        'Outro',
}

export const ARCHIVE_REASONS = [
  'Sem orçamento',
  'Escolheu concorrente',
  'Sem interesse',
  'Sem contato',
  'Timing ruim',
  'Outro',
] as const

export type ArchiveReason = typeof ARCHIVE_REASONS[number]

export const ORIGEM_OPTIONS = [
  'Orgânico',
  'Tráfego Pago',
  'Indicação',
  'Evento',
  'WhatsApp',
  'Outro',
] as const
