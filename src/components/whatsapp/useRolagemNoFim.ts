'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Distância (px) do fim em que ainda consideramos o usuário "no fim" da conversa. */
const MARGEM_FIM = 80

/** Rola o elemento até o fim, sem animação. */
function irParaFim(el: HTMLElement | null) {
  el?.scrollTo({ top: el.scrollHeight })
}

/**
 * Mantém a lista de mensagens no fim (mensagem mais recente), como no WhatsApp.
 *
 * - Ao abrir/trocar de conversa (`chave`), vai direto para o fim, sem animação.
 * - Enquanto o usuário estiver no fim, continua lá quando chegam mensagens novas
 *   (`qtdItens`) e quando imagens/vídeos terminam de carregar — antes a rolagem
 *   acontecia antes da mídia carregar e a conversa crescia "para baixo", deixando
 *   a tela no meio do histórico.
 * - Se o usuário subir para ler o histórico, não é puxado de volta.
 *
 * @param chave - Identifica a conversa (ex.: id); ao mudar, volta para o fim
 * @param qtdItens - Quantidade de itens exibidos (mensagens + notas)
 * @returns Ref de callback para o elemento com rolagem (overflow-y: auto)
 */
export function useRolagemNoFim(chave: string | null | undefined, qtdItens: number) {
  const elRef = useRef<HTMLElement | null>(null)
  const noFim = useRef(true)
  // Muda quando a lista é (re)montada — ex.: voltou para a aba da conversa
  const [montagem, setMontagem] = useState(0)

  const ref = useCallback((node: HTMLElement | null) => {
    elRef.current = node
    if (node) setMontagem(n => n + 1)
  }, [])

  // Conversa nova ou lista remontada: começa no fim. Layout effect = antes de
  // pintar a tela, para não aparecer o topo da conversa por um instante.
  useLayoutEffect(() => {
    noFim.current = true
    irParaFim(elRef.current)
  }, [chave, montagem])

  // Itens novos: acompanha só se o usuário estiver no fim
  useLayoutEffect(() => {
    if (noFim.current) irParaFim(elRef.current)
  }, [qtdItens])

  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const aoRolar = () => { noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < MARGEM_FIM }
    // load/loadedmetadata não sobem na árvore: escuta na fase de captura
    const aoCarregarMidia = () => { if (noFim.current) irParaFim(el) }
    el.addEventListener('scroll', aoRolar, { passive: true })
    el.addEventListener('load', aoCarregarMidia, true)
    el.addEventListener('loadedmetadata', aoCarregarMidia, true)
    return () => {
      el.removeEventListener('scroll', aoRolar)
      el.removeEventListener('load', aoCarregarMidia, true)
      el.removeEventListener('loadedmetadata', aoCarregarMidia, true)
    }
  }, [montagem])

  return ref
}
