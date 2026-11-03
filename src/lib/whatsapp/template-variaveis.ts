import type { SupabaseClient } from '@supabase/supabase-js'

export type TemplateParaEnvio = {
  content: string | null
  variable_order: unknown
  header_type: string | null
  header_image_url: string | null
}

export type ComponentesTemplate = {
  components: object[]
  renderedText: string
}

export function contarVariaveis(content: string | null): number {
  return (content?.match(/\{\{\d+\}\}/g) ?? []).length
}

/**
 * Monta o `components` do envio de template na Meta: corpo com os valores das
 * variáveis `{{N}}` e cabeçalho de imagem, quando o template tem. Sem eles a Meta
 * recusa templates com variáveis ou cabeçalho.
 */
export function montarComponentesTemplate(template: TemplateParaEnvio, valores: string[]): ComponentesTemplate {
  let components: object[] = []
  let renderedText = template.content ?? ''

  if (contarVariaveis(template.content) > 0) {
    components = [{
      type: 'body',
      parameters: valores.map(v => ({ type: 'text', text: v })),
    }]
    renderedText = template.content?.replace(
      /\{\{(\d+)\}\}/g,
      (_m: string, n: string) => valores[parseInt(n, 10) - 1] ?? `{{${n}}}`,
    ) ?? ''
  }

  if (template.header_type === 'IMAGE' && template.header_image_url) {
    components = [
      { type: 'header', parameters: [{ type: 'image', image: { link: template.header_image_url } }] },
      ...components,
    ]
  }

  return { components, renderedText }
}

export async function resolveVariables(
  supabase: SupabaseClient,
  unitId: string,
  leadId: string | null,
  variableOrder: string[] | null,
  varCount: number,
  nomeContato: string | null = null,
): Promise<string[]> {
  const order = variableOrder && variableOrder.length === varCount
    ? variableOrder
    : ['nome_cliente', 'nome_atendente', 'data', 'horario'].slice(0, varCount)

  let leadName = ''
  let atendenteName = ''

  if (order.includes('nome_cliente') || order.includes('nome_atendente')) {
    if (leadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('nome, sobrenome, responsavel_id')
        .eq('id', leadId)
        .single()

      if (lead) {
        leadName = [lead.nome, lead.sobrenome].filter(Boolean).join(' ')
        if (lead.responsavel_id && order.includes('nome_atendente')) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('nome')
            .eq('id', lead.responsavel_id)
            .single()
          atendenteName = profile?.nome ?? ''
        }
      }
    }

    if (!atendenteName && order.includes('nome_atendente')) {
      const { data: unit } = await supabase
        .from('units')
        .select('nome')
        .eq('id', unitId)
        .single()
      atendenteName = unit?.nome ?? 'Equipe'
    }
  }

  const now = new Date()
  return order.map(id => {
    switch (id) {
      case 'nome_cliente':    return leadName || nomeContato || 'Cliente'
      case 'nome_atendente':  return atendenteName || 'Equipe'
      case 'data':            return now.toLocaleDateString('pt-BR')
      case 'horario':         return now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      default:                return ''
    }
  })
}
