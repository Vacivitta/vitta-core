// ---- Perfis de acesso -------------------------------------------------------

export type UserPerfil = 'admin' | 'gestor_vacivitta' | 'gestor_unidade' | 'atendente'

export const PERFIL_LABELS: Record<UserPerfil, string> = {
  admin:            'Admin',
  gestor_vacivitta: 'Gestor Vacivitta',
  gestor_unidade:   'Gestor',
  atendente:        'Atendente',
}

// ---- Infraestrutura multi-tenant -------------------------------------------

export interface Tenant {
  id:         string
  nome:       string
  documento:  string | null
  ativo:      boolean
  criado_em:  string
}

export interface Unit {
  id:         string
  tenant_id:  string
  nome:       string
  cidade:     string | null
  estado:     string | null
  telefone:   string | null
  ativo:      boolean
  criado_em:  string
}

export interface UserUnit {
  id:         string
  user_id:    string
  unit_id:    string
  ativo:      boolean
  criado_em:  string
}

// ---- Usuários (extensão do auth.users) -------------------------------------

export interface Profile {
  id:         string
  full_name:  string
  apelido:    string | null
  avatar_url: string | null
  perfil:     UserPerfil
  unit_id:    string | null
  ativo:      boolean
  created_at: string
  email:      string | null
}

/** Retorna apelido se definido, senão o primeiro nome do full_name */
export function displayName(p: Pick<Profile, 'full_name' | 'apelido'>): string {
  if (p.apelido?.trim()) return p.apelido.trim()
  return p.full_name?.split(' ')[0] ?? p.full_name
}

// ---- Chat interno ----------------------------------------------------------

export interface InternalMessage {
  id:         string
  de_id:      string
  para_id:    string
  conteudo:   string
  lido:       boolean
  created_at: string
}

// ---- Funis -----------------------------------------------------------------

export interface Funnel {
  id:          string
  nome:        string
  descricao:   string | null
  ativo:       boolean
  ordem:       number
  unit_id:     string | null
  created_at:  string
}

export interface FunnelStage {
  id:           string
  funnel_id:    string
  nome:         string
  cor:          string
  ordem:        number
  alerta_horas: number | null
  unit_id:      string | null
  created_at:   string
}

export interface FunnelWithStages extends Funnel {
  stages: FunnelStage[]
}

// ---- Leads -----------------------------------------------------------------

export interface Lead {
  id:              string
  nome:            string
  sobrenome:       string | null
  profissao:       string | null
  cidade:          string | null
  estado:          string | null
  pais:            string | null
  instagram:       string | null
  site:            string | null
  email:           string | null
  telefone:        string | null
  origem:          string | null
  funnel_id:       string
  stage_id:        string
  responsavel_id:  string | null
  arquivado:       boolean
  motivo_perda:    string | null
  ordem:           number
  unit_id:         string | null
  is_converted:    boolean
  data_nascimento: string | null
  cpf:             string | null
  observacoes_cli: string | null
  wa_optin_at:     string | null
  wa_optout_at:    string | null
  campanha_id:     string | null
  stage_changed_at: string
  created_at:      string
  updated_at:      string
}

export interface LeadKanban extends Lead {
  responsavel_nome:   string | null
  responsavel_avatar: string | null
  stage_nome:         string | null
  stage_cor:          string | null
  stage_ordem:        number | null
  funnel_nome:        string | null
  valor_proposta:     number | null
  modelo:             string | null
  valor_negociado:    number | null
  stage_alerta_horas: number | null
  tarefas_pendentes:  number
  total_notas:        number
  total_contatos:     number
}

// ---- Relacionamentos do lead ------------------------------------------------

export type ContactRole = 'filho' | 'filha' | 'dependente' | 'outro'

export interface LeadContact {
  id:               string
  lead_id:          string
  nome:             string
  telefone:         string | null
  email:            string | null
  cargo:            ContactRole
  relacao:          ContactRole
  data_nascimento:  string | null
  observacao:       string | null
  unit_id:          string | null
  created_at:       string
}

export interface LeadNote {
  id:          string
  lead_id:     string
  conteudo:    string
  autor_id:    string | null
  unit_id:     string | null
  created_at:  string
  editado_em:  string | null
  autor?:      Profile
}

export interface LeadTask {
  id:             string
  lead_id:        string
  titulo:         string
  descricao:      string | null
  responsavel_id: string | null
  data_limite:    string | null
  lembrete_em:    string | null
  concluida:      boolean
  unit_id:        string | null
  created_at:     string
  updated_at:     string
  responsavel?:   Profile
}

export interface LeadNegotiation {
  id:              string
  lead_id:         string
  valor_proposta:  number | null
  modelo:          string | null
  valor_negociado: number | null
  updated_at:      string
}

export interface LeadResponsibleHistory {
  id:                       string
  lead_id:                  string
  responsavel_anterior_id:  string | null
  novo_responsavel_id:      string | null
  trocado_por_id:           string | null
  unit_id:                  string | null
  created_at:               string
  responsavel_anterior?:    Profile
  novo_responsavel?:        Profile
  trocado_por?:             Profile
}

// ---- Produtos --------------------------------------------------------------

export type ProductTipo = 'vacina' | 'pacote' | 'servico'

export const PRODUCT_TIPO_LABELS: Record<ProductTipo, string> = {
  vacina:  'Vacina',
  pacote:  'Pacote',
  servico: 'Serviço',
}

export interface Product {
  id:          string
  unit_id:     string
  nome:        string
  tipo:        ProductTipo | null
  descricao:   string | null
  valor_venda: number | null
  valor_custo: number | null
  ativo:       boolean
  criado_em:   string
}

export interface ProductPrice {
  id:               string
  product_id:       string
  unit_id:          string
  valor:            number
  vigencia_inicio:  string
  vigencia_fim:     string | null
  criado_em:        string
}

export interface ProductCurrentPrice {
  id:              string
  nome:            string
  tipo:            ProductTipo | null
  unit_id:         string
  descricao:       string | null
  valor:           number
  vigencia_inicio: string
}

// ---- Orçamentos ------------------------------------------------------------

// Triggers de automação: inclui todos os status + 'criado' (disparado na criação do orçamento)
export type AutomationTrigger = 'criado' | QuoteStatus

export type QuoteStatus =
  | 'rascunho'
  | 'enviado'
  | 'visualizado'
  | 'aceito'
  | 'recusado'
  | 'em_negociacao'
  | 'expirado'

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  rascunho:       'Rascunho',
  enviado:        'Enviado',
  visualizado:    'Visualizado',
  aceito:         'Aceito',
  recusado:       'Recusado',
  em_negociacao:  'Em Negociação',
  expirado:       'Expirado',
}

export const QUOTE_STATUS_COLORS: Record<QuoteStatus, string> = {
  rascunho:       'bg-gray-100 text-gray-600',
  enviado:        'bg-blue-100 text-blue-700',
  visualizado:    'bg-amber-100 text-amber-700',
  aceito:         'bg-emerald-100 text-emerald-700',
  recusado:       'bg-red-100 text-red-700',
  em_negociacao:  'bg-purple-100 text-purple-700',
  expirado:       'bg-orange-100 text-orange-700',
}

export interface PacoteOpcao {
  id:       string
  label:    string
  metodos:  string[]
  desconto: number
}

export const PACOTE_DEFAULTS: PacoteOpcao[] = [
  { id: 'a_vista',   label: 'À Vista',   metodos: ['Dinheiro', 'Débito', 'PIX', 'Crédito à Vista'], desconto: 10 },
  { id: 'parcelado', label: 'Parcelado', metodos: ['Crédito 6x a 10x'],                              desconto: 5  },
]

export interface Quote {
  id:              string
  unit_id:         string
  lead_id:         string | null
  template_id:     string | null
  numero:          number | null
  status:          QuoteStatus
  motivo_recusa:   string | null
  responsavel_id:  string | null
  validade_ate:    string | null
  observacoes:     string | null
  total_calculado: number | null
  token_publico:   string
  enviado_em:      string | null
  visualizado_em:  string | null
  aceito_em:       string | null
  pacote_ativo:    boolean
  pacote_opcoes:   PacoteOpcao[] | null
  criado_em:       string
  atualizado_em:   string
}

export interface QuoteItem {
  id:                  string
  quote_id:            string
  unit_id:             string
  product_id:          string
  nome_snapshot:       string
  descricao_snapshot:  string | null
  valor_snapshot:      number
  quantidade:          number
  desconto:            number
  valor_final:         number
  observacao:          string | null
  criado_em:           string
}

// ---- Templates de orçamento ------------------------------------------------

export type AgeGroup = 'crianca' | 'adulto' | 'idoso' | 'todos'

export const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  crianca: 'Criança',
  adulto:  'Adulto',
  idoso:   'Idoso',
  todos:   'Todos',
}

// Imagens de fundo por página do template
// A página de conteúdo usa sempre gradiente das cores do template — sem imagem
export interface TemplatePageImages {
  capa?:         string    // URL — página de capa
  intro?:        string[]  // URLs — páginas institucionais (0-N)
  encerramento?: string    // URL — página de encerramento
}

export interface QuoteTemplate {
  id:                  string
  unit_id:             string
  nome:                string
  age_group:           AgeGroup
  logo_url:            string | null
  cor_primaria:        string
  cor_secundaria:      string
  nome_clinica:        string | null
  endereco:            string | null
  cidade_estado:       string | null
  telefone_clinica:    string | null
  cnpj:                string | null
  texto_cabecalho:     string | null
  texto_rodape:        string | null
  validade_dias:       number
  paginas_imagens:     TemplatePageImages
  cor_texto_conteudo:  string
  is_default:          boolean
  ativo:               boolean
  criado_em:           string
  atualizado_em:       string
}

// Quote com itens expandidos (para PDF e exibição)
export interface QuoteWithItems extends Quote {
  items:    QuoteItem[]
  template: QuoteTemplate | null
  lead?:    { nome: string; sobrenome: string | null; telefone: string | null } | null
}

// ---- Histórico de stages ---------------------------------------------------

export interface LeadStageHistory {
  id:            string
  lead_id:       string
  de_stage_id:   string | null
  para_stage_id: string
  movido_por:    string | null
  criado_em:     string
}

// ---- Notificações ----------------------------------------------------------

export interface Notification {
  id:        string
  unit_id:   string
  user_id:   string | null
  type:      string
  title:     string
  body:      string | null
  quote_id:  string | null
  lead_id:   string | null
  lida:      boolean
  criado_em: string
}

// ---- Constantes estáticas --------------------------------------------------

export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  filho:       'Filho',
  filha:       'Filha',
  dependente:  'Dependente',
  outro:       'Outro',
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
  'Indicação',
  'Instagram',
  'Tráfego Pago',
  'WhatsApp',
  'Google',
  'Evento',
  'Posto de saúde',
  'Orgânico',
  'Outro',
] as const
