/**
 * WebM → MP3 conversion using ffmpeg.
 * Currently unused — kept for potential future use.
 */

import { execFileSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import os from 'os'

export async function convertWebmToMp3(webm: Buffer): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegPath = require('ffmpeg-static') as string
  if (!ffmpegPath) throw new Error('[webm-to-mp3] ffmpeg-static binary not found')

  const id = randomBytes(8).toString('hex')
  const tmpDir = os.tmpdir()
  const inputPath = join(tmpDir, `wa-mp3-input-${id}.webm`)
  const outputPath = join(tmpDir, `wa-mp3-output-${id}.mp3`)

  try {
    writeFileSync(inputPath, webm)

    execFileSync(ffmpegPath, [
      '-i', inputPath,
      '-c:a', 'libmp3lame',
      '-b:a', '64k',
      '-ar', '48000',
      '-ac', '1',
      '-y',
      outputPath,
    ], { timeout: 30000, stdio: 'pipe' })

    const result = readFileSync(outputPath)
    console.log(`[webm-to-mp3] webm=${webm.length}B mp3=${result.length}B`)
    return result
  } finally {
    try { unlinkSync(inputPath) } catch { /* ignore */ }
    try { unlinkSync(outputPath) } catch { /* ignore */ }
  }
}
