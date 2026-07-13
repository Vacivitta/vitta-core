/**
 * WebM/Opus → OGG/Opus conversion using ffmpeg.
 * Converts Chrome MediaRecorder output (~380kbps WebM) to
 * WhatsApp-compatible OGG Opus (16kbps, mono, 48kHz).
 */

import { execFileSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import os from 'os'

function getFfmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegPath = require('ffmpeg-static') as string
  if (!ffmpegPath) throw new Error('[webm-to-ogg] ffmpeg-static binary not found')
  return ffmpegPath
}

export function convertWebmToOgg(webm: Buffer): Buffer {
  const id = randomBytes(8).toString('hex')
  const tmpDir = os.tmpdir()
  const inputPath = join(tmpDir, `wa-input-${id}.webm`)
  const outputPath = join(tmpDir, `wa-output-${id}.ogg`)

  try {
    writeFileSync(inputPath, webm)

    const ffmpeg = getFfmpegPath()
    execFileSync(ffmpeg, [
      '-i', inputPath,
      '-c:a', 'libopus',
      '-b:a', '16k',
      '-ar', '48000',
      '-ac', '1',
      '-application', 'voip',
      '-vbr', 'on',
      '-y',
      outputPath,
    ], {
      timeout: 30000,
      stdio: 'pipe',
    })

    const result = readFileSync(outputPath)
    if (result.length === 0) throw new Error('[webm-to-ogg] ffmpeg produced empty output')
    return result
  } finally {
    try { unlinkSync(inputPath) } catch { /* ignore */ }
    try { unlinkSync(outputPath) } catch { /* ignore */ }
  }
}
