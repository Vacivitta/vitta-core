import type { CampoLead, CamposDoLead, ValorCampo } from '@/types/database'
import { chaveDoRotulo, valorDaEntrada, valorValido, type EntradaCampo, type ResultadoEntrada } from './campos.ts'
import { desfazerCelulaSegura, registroVazio } from './csv.ts'
import { formatarTelefone, normalizarTelefone } from './telefone.ts'

// Regras da importação de leads por planilha. A tela usa para a
// pré-visualização e POST /api/leads/importar repete tudo no servidor.

export const MAX_LINHAS_IMPORTACAO = 5000
export const MAX_BYTES_IMPORTACAO  = 5 * 1024 * 1024

export const COLUNAS_LEAD = [
  'nome', 'sobrenome', 'telefone', 'email', 'cidade', 'estado', 'profissao', 'origem', 'observacoes_cli',
  'data_nascimento',
] as const
export type ColunaLead = typeof COLUNAS_LEAD[number]

/** Para onde vai cada coluna da planilha. */
export type Destino = ColunaLead | 'tags' | 'ignorar' | `campo:${string}`

export const ROTULOS_COLUNA: Record<ColunaLead, string> = {
  nome:            'Nome',
  sobrenome:       'Sobrenome',
  telefone:        'Telefone',
  email:           'E-mail',
  cidade:          'Cidade',
  estado:          'Estado',
  profissao:       'Profissão',
  origem:          'Origem',
  observacoes_cli: 'Observações',
  data_nascimento: 'Data de nascimento',
}

export function ehDestino(v: unknown): v is Destino {
  if (typeof v !== 'string') return false
  return (COLUNAS_LEAD as readonly string[]).includes(v) || v === 'tags' || v === 'ignorar'
    || (v.startsWith('campo:') && v.length > 6)
}

export function chaveDoDestino(d: Destino): string | null {
  return d.startsWith('campo:') ? d.slice(6) : null
}

const SINONIMOS: Record<ColunaLead | 'tags', string[]> = {
  nome:            ['nome', 'nome_completo', 'name', 'cliente', 'contato', 'paciente', 'nome_do_cliente', 'nome_cliente', 'lead'],
  sobrenome:       ['sobrenome', 'ultimo_nome', 'last_name', 'surname'],
  telefone:        ['telefone', 'tel', 'celular', 'whatsapp', 'whats', 'fone', 'phone', 'numero', 'telefone_celular', 'cel'],
  email:           ['email', 'e_mail', 'mail', 'endereco_de_email'],
  cidade:          ['cidade', 'municipio', 'city'],
  estado:          ['estado', 'uf'],
  profissao:       ['profissao', 'cargo', 'ocupacao'],
  origem:          ['origem', 'fonte', 'canal', 'source'],
  observacoes_cli: ['observacoes', 'observacao', 'obs', 'notas', 'anotacoes', 'comentarios'],
  data_nascimento: ['data_nascimento', 'data_de_nascimento', 'nascimento', 'aniversario', 'dt_nasc', 'dt_nascimento'],
  tags:            ['tags', 'tag', 'etiquetas', 'etiqueta', 'marcadores'],
}

const CONTEM: [ColunaLead, RegExp][] = [
  ['telefone',        /telefone|celular|whats|fone|phone/],
  ['email',           /e_?mail/],
  ['data_nascimento', /nasc/],
  ['observacoes_cli', /^obs/],
]

/**
 * Mapeamento sugerido pelo cabeçalho: nome exato (ou sinônimo) de coluna do
 * lead, rótulo de campo personalizado, depois palavras-chave. Cada destino é
 * usado uma vez; o que não casar fica "ignorar".
 */
export function sugerirMapeamento(cabecalho: readonly string[], campos: readonly CampoLead[]): Destino[] {
  const usados = new Set<Destino>()
  const escolher = (d: Destino | undefined): Destino => {
    if (!d || usados.has(d)) return 'ignorar'
    usados.add(d)
    return d
  }
  const slugs = cabecalho.map(h => (h.trim() ? chaveDoRotulo(h) : ''))
  const resultado: Destino[] = slugs.map(() => 'ignorar')

  const rodadas: ((slug: string) => Destino | undefined)[] = [
    slug => (Object.keys(SINONIMOS) as (ColunaLead | 'tags')[]).find(d => SINONIMOS[d].includes(slug)),
    slug => {
      const c = campos.find(c => c.chave === slug || chaveDoRotulo(c.rotulo) === slug)
      return c ? `campo:${c.chave}` : undefined
    },
    slug => CONTEM.find(([, re]) => re.test(slug))?.[0],
  ]
  for (const rodada of rodadas) {
    slugs.forEach((slug, i) => {
      if (slug && resultado[i] === 'ignorar') resultado[i] = escolher(rodada(slug))
    })
  }
  return resultado
}

/** Erro de configuração do mapeamento, ou null se dá para importar. */
export function validarMapeamento(mapeamento: readonly Destino[], campos: readonly CampoLead[]): string | null {
  if (!mapeamento.includes('nome')) return 'Escolha a coluna do nome'
  if (!mapeamento.includes('telefone')) return 'Escolha a coluna do telefone'
  const usados = mapeamento.filter(d => d !== 'ignorar')
  const repetido = usados.find((d, i) => usados.indexOf(d) !== i)
  if (repetido) return `Duas colunas foram para "${rotuloDestino(repetido, campos)}"`
  for (const d of usados) {
    const chave = chaveDoDestino(d)
    if (chave !== null && !campos.some(c => c.chave === chave)) {
      return 'Um campo personalizado escolhido não vale para este funil ou foi desativado'
    }
  }
  return null
}

export function rotuloDestino(d: Destino, campos: readonly CampoLead[]): string {
  if (d === 'tags') return 'Tags'
  if (d === 'ignorar') return 'Ignorar'
  const chave = chaveDoDestino(d)
  if (chave !== null) return campos.find(c => c.chave === chave)?.rotulo ?? chave
  return ROTULOS_COLUNA[d as ColunaLead]
}

/** Texto para comparar nomes de opção e de tag: sem acento, minúsculo, espaços únicos. */
function comparavel(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** "31/12/1990", "1/2/1990", "31-12-1990", "31.12.1990" ou "1990-12-31" → "1990-12-31". */
export function lerDataBR(texto: string): string | null {
  const s = texto.trim()
  let iso: string | null = null
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (br) iso = `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = s
  return iso && valorValido('data', null, iso) ? iso : null
}

const SIM = new Set(['sim', 's', 'x', 'true', 'verdadeiro', '1', 'yes', 'y'])
const NAO = new Set(['nao', 'n', 'false', 'falso', '0', 'no'])

/** Texto da planilha → valor do campo personalizado, com as regras de src/lib/campos.ts. */
export function valorDaPlanilha(campo: CampoLead, texto: string): ResultadoEntrada {
  const t = texto.trim()
  if (t === '') return { ok: true, valor: null }
  let entrada: EntradaCampo = t
  switch (campo.tipo) {
    case 'data':
      entrada = lerDataBR(t) ?? t
      break
    case 'sim_nao': {
      const c = comparavel(t)
      if (SIM.has(c)) entrada = true
      else if (NAO.has(c)) entrada = false
      else return { ok: false, erro: 'Use Sim ou Não' }
      break
    }
    case 'selecao':
      entrada = campo.opcoes.find(o => comparavel(o) === comparavel(t)) ?? t
      break
    case 'multipla': {
      const itens = t.split(/[,;]/).map(i => i.trim()).filter(Boolean)
      entrada = [...new Set(itens.map(i => campo.opcoes.find(o => comparavel(o) === comparavel(i)) ?? i))]
      break
    }
    default:
      break
  }
  return valorDaEntrada(campo, entrada)
}

export interface DadosLead {
  nome:            string
  sobrenome:       string | null
  telefone:        string
  email:           string | null
  cidade:          string | null
  estado:          string | null
  profissao:       string | null
  origem:          string | null
  observacoes_cli: string | null
  data_nascimento: string | null
}

export interface LinhaPronta {
  /** Número da linha na planilha (o cabeçalho é a 1) */
  linha:        number
  dados:        DadosLead
  telefoneNorm: string
  campos:       CamposDoLead
  tagIds:       string[]
}

export interface LinhaInvalida  { linha: number; motivo: string }
export interface LinhaRepetida  { linha: number; telefone: string; primeiraLinha: number }
export interface LinhaExistente { linha: number; telefone: string }

export interface Preparacao {
  linhas:            LinhaPronta[]
  invalidas:         LinhaInvalida[]
  /** Mesmo telefone (normalizado) de uma linha anterior do arquivo: só a primeira entra */
  repetidas:         LinhaRepetida[]
  /** Nomes de tag que não existem na unidade (ignorados) */
  tagsDesconhecidas: string[]
}

export interface ContextoImportacao {
  /** Campos que valem para o funil de destino (camposDoFunil) */
  campos:       readonly CampoLead[]
  tags:         readonly { id: string; name: string }[]
  /** Origem gravada quando a linha não tem uma */
  origemPadrao: string | null
}

const TAMANHO_MAXIMO_TEXTO = 2000

/**
 * Valida e converte as linhas (registros[0] é o cabeçalho). Linhas em branco
 * são ignoradas sem aviso.
 */
export function prepararImportacao(
  registros: readonly (readonly string[])[],
  mapeamento: readonly Destino[],
  ctx: ContextoImportacao,
): Preparacao {
  const tagPorNome = new Map(ctx.tags.map(t => [comparavel(t.name), t.id]))
  const campoPorChave = new Map(ctx.campos.map(c => [c.chave, c]))
  const desconhecidas = new Map<string, string>()
  const primeiraPorTelefone = new Map<string, number>()
  const resultado: Preparacao = { linhas: [], invalidas: [], repetidas: [], tagsDesconhecidas: [] }

  for (let i = 1; i < registros.length; i++) {
    const registro = registros[i]
    const linha = i + 1
    if (registroVazio(registro)) continue

    const base: Partial<Record<ColunaLead, string>> = {}
    const campos: Record<string, ValorCampo> = {}
    const tagIds = new Set<string>()
    const erros: string[] = []

    mapeamento.forEach((destino, col) => {
      const texto = desfazerCelulaSegura((registro[col] ?? '').trim())
      if (destino === 'ignorar' || texto === '') return
      if (destino === 'tags') {
        for (const nome of texto.split(/[,;]/).map(n => n.trim()).filter(Boolean)) {
          const id = tagPorNome.get(comparavel(nome))
          if (id) tagIds.add(id)
          else if (!desconhecidas.has(comparavel(nome))) desconhecidas.set(comparavel(nome), nome)
        }
        return
      }
      const chave = chaveDoDestino(destino)
      if (chave !== null) {
        const campo = campoPorChave.get(chave)
        if (!campo) return
        const r = valorDaPlanilha(campo, texto)
        if (!r.ok) erros.push(`${campo.rotulo}: ${r.erro}`)
        else if (r.valor !== null) campos[chave] = r.valor
        return
      }
      base[destino as ColunaLead] = texto
    })

    const telefoneNorm = normalizarTelefone(base.telefone)
    if (!base.telefone) erros.unshift('Sem telefone')
    else if (!telefoneNorm) erros.unshift(`Telefone inválido: ${base.telefone}`)

    const nome = base.nome ?? ''
    if (!nome) erros.unshift('Sem nome')

    const email = base.email?.toLowerCase() ?? null
    if (email && !valorValido('email', null, email)) erros.push(`E-mail inválido: ${base.email}`)

    const nascimento = base.data_nascimento ? lerDataBR(base.data_nascimento) : null
    if (base.data_nascimento && !nascimento) erros.push(`Data de nascimento inválida: ${base.data_nascimento}`)

    const longa = (Object.keys(base) as ColunaLead[]).find(k => Array.from(base[k] ?? '').length > TAMANHO_MAXIMO_TEXTO)
    if (longa) erros.push(`${ROTULOS_COLUNA[longa]} com mais de ${TAMANHO_MAXIMO_TEXTO} caracteres`)

    if (erros.length > 0 || !telefoneNorm) {
      resultado.invalidas.push({ linha, motivo: erros.join('; ') })
      continue
    }

    const primeira = primeiraPorTelefone.get(telefoneNorm)
    if (primeira !== undefined) {
      resultado.repetidas.push({ linha, telefone: formatarTelefone(telefoneNorm), primeiraLinha: primeira })
      continue
    }
    primeiraPorTelefone.set(telefoneNorm, linha)

    resultado.linhas.push({
      linha,
      telefoneNorm,
      campos,
      tagIds: [...tagIds],
      dados: {
        nome,
        sobrenome:       base.sobrenome ?? null,
        telefone:        formatarTelefone(telefoneNorm),
        email,
        cidade:          base.cidade ?? null,
        estado:          base.estado ?? null,
        profissao:       base.profissao ?? null,
        origem:          base.origem ?? ctx.origemPadrao,
        observacoes_cli: base.observacoes_cli ?? null,
        data_nascimento: nascimento,
      },
    })
  }

  resultado.tagsDesconhecidas = [...desconhecidas.values()]
  return resultado
}

/** Tira as linhas cujo telefone já existe na unidade (serão puladas, não atualizadas). */
export function separarExistentes(
  linhas: readonly LinhaPronta[],
  existentes: ReadonlySet<string>,
): { novas: LinhaPronta[]; existentes: LinhaExistente[] } {
  const novas: LinhaPronta[] = []
  const jaExistem: LinhaExistente[] = []
  for (const l of linhas) {
    if (existentes.has(l.telefoneNorm)) jaExistem.push({ linha: l.linha, telefone: l.dados.telefone })
    else novas.push(l)
  }
  return { novas, existentes: jaExistem }
}

/** Corpo de POST /api/leads/importar. */
export interface PedidoImportacao {
  /** Conteúdo do arquivo já decodificado (o navegador decide UTF-8 ou Windows-1252) */
  texto:          string
  mapeamento:     Destino[]
  funnel_id:      string
  stage_id:       string
  responsavel_id: string | null
  origem_padrao:  string | null
  /** "Já são clientes": status ganho e is_converted, sem data de ganho */
  clientes:       boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Valida o formato do corpo (as regras de negócio a rota confere no banco). */
export function lerPedidoImportacao(body: unknown): { ok: true; pedido: PedidoImportacao } | { ok: false; erro: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, erro: 'Corpo inválido' }
  const b = body as Record<string, unknown>
  if (typeof b.texto !== 'string' || b.texto.trim() === '') return { ok: false, erro: 'Arquivo vazio' }
  if (b.texto.length > MAX_BYTES_IMPORTACAO) return { ok: false, erro: 'Arquivo maior que 5 MB' }
  if (!Array.isArray(b.mapeamento) || !b.mapeamento.every(ehDestino)) return { ok: false, erro: 'Mapeamento inválido' }
  if (typeof b.funnel_id !== 'string' || !UUID.test(b.funnel_id)) return { ok: false, erro: 'Escolha o funil' }
  if (typeof b.stage_id !== 'string' || !UUID.test(b.stage_id)) return { ok: false, erro: 'Escolha a etapa' }
  if (b.responsavel_id !== null && (typeof b.responsavel_id !== 'string' || !UUID.test(b.responsavel_id))) {
    return { ok: false, erro: 'Responsável inválido' }
  }
  if (b.origem_padrao !== null && (typeof b.origem_padrao !== 'string' || b.origem_padrao.length > 100)) {
    return { ok: false, erro: 'Origem inválida' }
  }
  if (typeof b.clientes !== 'boolean') return { ok: false, erro: 'Informe se são clientes' }
  return {
    ok: true,
    pedido: {
      texto:          b.texto,
      mapeamento:     b.mapeamento,
      funnel_id:      b.funnel_id,
      stage_id:       b.stage_id,
      responsavel_id: b.responsavel_id,
      origem_padrao:  typeof b.origem_padrao === 'string' && b.origem_padrao.trim() ? b.origem_padrao.trim() : null,
      clientes:       b.clientes,
    },
  }
}

/** Resposta de POST /api/leads/importar. */
export interface RelatorioImportacao {
  importados: number
  existentes: LinhaExistente[]
  repetidas:  LinhaRepetida[]
  invalidas:  LinhaInvalida[]
  tagsDesconhecidas: string[]
  avisos:     string[]
}
