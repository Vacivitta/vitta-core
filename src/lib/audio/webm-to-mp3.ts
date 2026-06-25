import { extractWebmData } from './webm-to-ogg'

export async function convertWebmToMp3(webm: Buffer): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OpusScript = require('opusscript') as {
    new(sampleRate: number, channels: number): {
      decode(buf: Buffer, frameSize: number): Buffer
      delete(): void
    }
  }
  const { Mp3Encoder } = await import('@breezystack/lamejs')

  const { packets, codecPrivate } = extractWebmData(webm)
  if (packets.length === 0) throw new Error('[webm-to-mp3] no Opus packets found in WebM')

  const channels    = (codecPrivate && codecPrivate.length > 9) ? (codecPrivate[9] ?? 1) : 1
  const SAMPLE_RATE = 48000
  const FRAME_SIZE  = 960 // 20ms @ 48kHz

  const dec     = new OpusScript(SAMPLE_RATE, channels)
  const encoder = new Mp3Encoder(1, SAMPLE_RATE, 64) // always mono output at 64kbps

  const parts: Buffer[] = []

  for (const pkt of packets) {
    try {
      const pcm    = dec.decode(pkt, FRAME_SIZE)
      const total  = pcm.byteLength / 2  // Int16 samples (all channels)
      const mono   = channels === 2 ? total / 2 : total
      const int16  = new Int16Array(mono)
      const src    = new Int16Array(pcm.buffer, pcm.byteOffset, total)
      if (channels === 2) {
        for (let i = 0; i < mono; i++) int16[i] = (src[i * 2] + src[i * 2 + 1]) >> 1
      } else {
        for (let i = 0; i < mono; i++) int16[i] = src[i]
      }
      const mp3Data = encoder.encodeBuffer(int16)
      if (mp3Data.length > 0) parts.push(Buffer.from(mp3Data.buffer, mp3Data.byteOffset, mp3Data.byteLength))
    } catch {
      // skip corrupt packet
    }
  }

  const flushData = encoder.flush()
  if (flushData.length > 0) parts.push(Buffer.from(flushData.buffer, flushData.byteOffset, flushData.byteLength))

  dec.delete()

  const total = parts.reduce((s, p) => s + p.length, 0)
  const result = Buffer.alloc(total)
  let offset = 0
  for (const p of parts) { result.set(p, offset); offset += p.length }

  console.log(`[webm-to-mp3] webm=${webm.length}B packets=${packets.length} mp3=${total}B`)
  return result
}
