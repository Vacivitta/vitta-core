/**
 * WebM → OGG/Opus conversion using ffmpeg.
 * Converts Chrome MediaRecorder output (~380kbps WebM) to
 * WhatsApp-compatible OGG Opus (mono, 48kHz, low bitrate).
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
      '-c:a', 'copy',
      '-f', 'ogg',
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

export function convertWebmToMp4(webm: Buffer): Buffer {
  const id = randomBytes(8).toString('hex')
  const tmpDir = os.tmpdir()
  const inputPath = join(tmpDir, `wa-mp4-input-${id}.webm`)
  const outputPath = join(tmpDir, `wa-mp4-output-${id}.mp4`)

  try {
    writeFileSync(inputPath, webm)

    const ffmpeg = getFfmpegPath()
    execFileSync(ffmpeg, [
      '-i', inputPath,
      '-f', 'mp4',
      '-c:a', 'aac',
      '-b:a', '32k',
      '-ar', '44100',
      '-ac', '1',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ], {
      timeout: 30000,
      stdio: 'pipe',
    })

    const result = readFileSync(outputPath)
    if (result.length === 0) throw new Error('[webm-to-mp4] ffmpeg produced empty output')
    return result
  } finally {
    try { unlinkSync(inputPath) } catch { /* ignore */ }
    try { unlinkSync(outputPath) } catch { /* ignore */ }
  }
}
