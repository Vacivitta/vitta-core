/**
 * Primeiro caractere do nome, em maiúscula — para avatares de iniciais.
 * Usa code points (Array.from) em vez de `str[0]`: nomes que começam com emoji
 * dariam metade de um par surrogate, que o servidor serializa como "�" e o
 * navegador não, causando erro de hidratação (React #418).
 */
export function primeiraLetra(nome: string | null | undefined): string {
  return (Array.from(nome ?? '')[0] ?? '').toUpperCase()
}
