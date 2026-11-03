import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Autoriza chamadas às rotas de cron (`Authorization: Bearer <CRON_SECRET>`).
 * Fail-closed: sem `CRON_SECRET` configurado, nenhuma chamada passa.
 */
export function cronAutorizado(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const recebido = req.headers.get('authorization') ?? ''
  // Compara digests de tamanho fixo: timingSafeEqual exige buffers do mesmo
  // tamanho, e comparar o texto direto vazaria o tamanho do segredo
  const digest = (valor: string) => createHash('sha256').update(valor).digest()
  return timingSafeEqual(digest(recebido), digest(`Bearer ${secret}`))
}
