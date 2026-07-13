import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['opusscript', '@breezystack/lamejs', 'ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/whatsapp/send-media': ['./node_modules/ffmpeg-static/**/*'],
  },
};

export default nextConfig;
