// npm run dev:teste — o app local (porta 3001) sobre o ambiente de teste da VPS.
// Abre o túnel SSH para 127.0.0.1:54321 da VPS e roda `next dev` com as chaves de
// .env.ambiente-teste.local (gerado por scripts/ambiente-teste/subir.sh). As
// variáveis do processo valem antes dos arquivos .env, então um .env.local
// apontando para a produção não é usado.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createConnection } from 'node:net'

const ARQUIVO = '.env.ambiente-teste.local'
const PORTA_TUNEL = 54321
const host = process.env.AMBIENTE_TESTE_SSH ?? 'vps'

let texto
try {
  texto = readFileSync(ARQUIVO, 'utf8')
} catch {
  console.error(`${ARQUIVO} não existe: rode antes  bash scripts/ambiente-teste/subir.sh`)
  process.exit(1)
}
const variaveis = Object.fromEntries(
  texto.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)

const portaAberta = () => new Promise(resolve => {
  const s = createConnection(PORTA_TUNEL, '127.0.0.1')
  s.once('connect', () => { s.end(); resolve(true) })
  s.once('error', () => resolve(false))
})

let tunel = null
if (await portaAberta()) {
  console.log(`túnel já aberto em localhost:${PORTA_TUNEL}`)
} else {
  tunel = spawn('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `${PORTA_TUNEL}:127.0.0.1:${PORTA_TUNEL}`, host], { stdio: 'inherit' })
  for (let i = 0; i < 30 && !(await portaAberta()); i++) await new Promise(r => setTimeout(r, 500))
  if (!(await portaAberta())) {
    console.error(`túnel para ${host} não abriu (localhost:${PORTA_TUNEL})`)
    tunel.kill()
    process.exit(1)
  }
  console.log(`túnel aberto: localhost:${PORTA_TUNEL} → ${host}:127.0.0.1:${PORTA_TUNEL}`)
}

const next = spawn('npx', ['next', 'dev', '-p', '3001'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, ...variaveis },
})
const encerrar = () => { tunel?.kill(); next.kill() }
process.on('SIGINT', encerrar)
process.on('SIGTERM', encerrar)
next.on('exit', codigo => { tunel?.kill(); process.exit(codigo ?? 0) })
