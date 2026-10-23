# Imagem de produção do vitta-core para a VPS (Coolify).
# O build roda no GitHub Actions (.github/workflows/docker-image.yml), não na VPS:
# um build do Next.js consome 1,5–2,5 GB de RAM e os 2 vCPUs, o que derrubaria
# os outros projetos hospedados no mesmo servidor.

# ── Dependências ─────────────────────────────────────────────────────────────
# Debian (glibc) em vez de Alpine: o ffmpeg-static baixado no postinstall é usado
# pela conversão de áudio do WhatsApp (send-media).
FROM node:24-bookworm-slim AS deps
WORKDIR /app
# .npmrc traz legacy-peer-deps (o @emoji-mart/react declara peer react ≤ 18)
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Variáveis NEXT_PUBLIC_* são embutidas no bundle do navegador em tempo de build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Execução ─────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

# next start finaliza requisições e callbacks de after() pendentes ao receber
# SIGTERM — o Coolify envia SIGTERM e aguarda antes de remover o container.
CMD ["node", "server.js"]
