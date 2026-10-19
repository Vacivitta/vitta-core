'use client'

import { useEffect, useState } from 'react'

/**
 * Relógio compartilhado para cálculos de tempo na renderização ("há 3h", SLA, tarefa
 * vencida). Evita chamar `Date.now()` durante o render — que deixa o resultado
 * instável — e faz os cards se atualizarem sozinhos a cada intervalo.
 *
 * @param intervalMs - De quanto em quanto tempo o valor é atualizado
 * @returns Timestamp atual em milissegundos
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
