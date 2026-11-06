import { COOKIE_UNIDADE } from './unidade-ativa'

const CHAVE_DA_ABA = 'vd_unidade'

/** Unidade escolhida nesta aba (sessionStorage), ou null numa aba nova. */
export function lerUnidadeDaAba(): string | null {
  try { return sessionStorage.getItem(CHAVE_DA_ABA) } catch { return null }
}

export function lerCookieDaUnidade(): string | null {
  const par = document.cookie.split('; ').find(c => c.startsWith(`${COOKIE_UNIDADE}=`))
  return par ? decodeURIComponent(par.slice(COOKIE_UNIDADE.length + 1)) : null
}

/** O servidor lê a unidade do cookie: a aba em foco o reescreve com a sua. */
export function escreverCookieDaUnidade(unidade: string) {
  const seguro = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE_UNIDADE}=${encodeURIComponent(unidade)}; path=/; max-age=31536000; SameSite=Lax${seguro}`
}

export function gravarUnidadeDaAba(unidade: string) {
  try { sessionStorage.setItem(CHAVE_DA_ABA, unidade) } catch { /* aba sem sessionStorage: vale o cookie */ }
  escreverCookieDaUnidade(unidade)
}
