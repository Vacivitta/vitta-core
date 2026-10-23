import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera .next/standalone (servidor Node mínimo) para a imagem Docker da VPS.
  // A Vercel ignora essa opção e continua com o próprio empacotamento.
  output: 'standalone',
  serverExternalPackages: ['opusscript', '@breezystack/lamejs', 'ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/whatsapp/send-media': ['./node_modules/ffmpeg-static/**/*'],
  },
};

export default nextConfig;
