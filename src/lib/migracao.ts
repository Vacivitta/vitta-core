/**
 * Congelamento da Vercel durante a troca para a VPS (26/10/2026).
 *
 * Só vale na Vercel (`VERCEL=1` é definido pela própria plataforma); na VPS é `null`
 * e nada muda. Enquanto o DNS de vittadesk.com.br ainda aponta para a Vercel:
 * - as telas mostram uma página de manutenção (o banco antigo não recebe mais escritas);
 * - o webhook da Meta é repassado para a VPS. Se a VPS ainda não estiver pronta,
 *   responde 503 e a Meta reenvia o evento mais tarde — nenhuma mensagem se perde.
 *
 * Remover este arquivo (e os usos) depois que o projeto da Vercel for desligado.
 */
export const MIGRACAO_VPS_URL: string | null = process.env.VERCEL
  ? 'https://vittadesk.app.vacivitta.com.br'
  : null

/** Página exibida pela Vercel durante a troca. */
export const PAGINA_MANUTENCAO = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VittaDesk — em manutenção</title>
<meta http-equiv="refresh" content="60">
<style>body{font-family:system-ui,sans-serif;background:#f6f8f6;color:#25402C;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}
.c{max-width:420px}h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#4b6352;line-height:1.5}</style></head>
<body><div class="c"><h1>Estamos atualizando o VittaDesk</h1>
<p>O sistema volta em alguns minutos. As mensagens dos clientes não serão perdidas.<br>
Esta página recarrega sozinha; depois será preciso entrar de novo.</p></div></body></html>`
