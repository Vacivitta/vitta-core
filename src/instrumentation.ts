import type { Instrumentation } from 'next'
import type { AppErrorOrigem } from '@/types/database'

const ROTAS_CRON = [
  '/api/orcamento/check-expiring',
  '/api/whatsapp/process-scheduled',
  '/api/whatsapp/process-timed-automations',
]

type ContextoNext = Parameters<Instrumentation.onRequestError>[2]

function origemDe({ routeType, routePath }: ContextoNext): AppErrorOrigem {
  switch (routeType) {
    case 'render': return 'renderizacao'
    case 'action': return 'acao'
    case 'route':
      if (routePath.includes('/api/whatsapp/webhook')) return 'webhook'
      if (ROTAS_CRON.some(r => routePath.includes(r))) return 'cron'
      return 'rota'
    case 'proxy':  return 'outro'
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { registrarErro } = await import('@/lib/erros/registrar')
  const digest = typeof err === 'object' && err !== null && 'digest' in err && typeof err.digest === 'string'
    ? err.digest
    : undefined
  await registrarErro(err, {
    origem: origemDe(context),
    // O modelo da rota (ex.: /api/leads/[id]), nunca o caminho real: a URL pode trazer id, telefone ou token
    rota:   context.routePath,
    metodo: request.method,
    digest,
  })
}
