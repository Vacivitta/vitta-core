'use client'

import { useEffect, useState } from 'react'

/**
 * Relógio compartilhado para cálculos de tempo na renderização ("há 3h", SLA, tarefa
 * vencida). Evita chamar `Date.now()` durante o render — que deixa o resultado
 * instável — e faz os cards se atualizarem sozinhos a cada intervalo.
 *
 * @param intervalMs - De quanto em quanto tempo o valor é atualizado
 * @param inicial - Date.now() do servidor: a primeira renderização usa o mesmo instante
 *   no servidor e no navegador (sem isso o React acusa diferença de hidratação, erro #418)
 * @returns Timestamp atual em milissegundos
 */
export function useNow(intervalMs = 60_000, inicial?: number): number {
  const [now, setNow] = useState(() => inicial ?? Date.now())
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza com o relógio real após hidratar
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
