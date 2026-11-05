import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera .next/standalone (servidor Node mínimo) para a imagem Docker da VPS.
  // A Vercel ignora essa opção e continua com o próprio empacotamento.
  output: 'standalone',
  experimental: {
    // Com proxy (src/proxy.ts), o Next guarda uma cópia do corpo e entrega à rota
    // só os primeiros 10 MB (padrão), sem erro. Os anexos do lead vão até 20 MB
    // (api/leads/[id]/anexos) mais os cabeçalhos do multipart.
    proxyClientMaxBodySize: '21mb',
  },
  serverExternalPackages: ['opusscript', '@breezystack/lamejs', 'ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/whatsapp/send-media': ['./node_modules/ffmpeg-static/**/*'],
  },
};

export default nextConfig;
