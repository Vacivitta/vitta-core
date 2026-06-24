/**
 * Pure Node.js WebM/Opus → OGG/Opus container remuxer.
 * Extracts raw Opus packets from Chrome MediaRecorder WebM output
 * and repackages them in an OGG container per RFC 3533 + RFC 7845.
 * No ffmpeg, no native bindings — runs fine on Vercel serverless.
 */

// OGG CRC32: polynomial 0x04C11DB7 (non-reflected, big-endian)
const OGG_CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i << 24
    for (let j = 0; j < 8; j++) c = (c & 0x80000000) ? ((c << 1) ^ 0x04c11db7) >>> 0 : (c << 1) >>> 0
    t[i] = c
  }
  return t
})()

function oggCrc32(buf: Buffer): number {
  let c = 0
  for (let i = 0; i < buf.length; i++)
    c = (((c << 8) >>> 0) ^ OGG_CRC_TABLE[((c >>> 24) ^ buf[i]) & 0xff]) >>> 0
  return c
}

function makeOggPage(
  headerType: number,
  granuleLo: number, // low 32 bits of 64-bit granule position
  serial: number,
  seq: number,
  pkt: Buffer,
  granuleHi = 0,    // high 32 bits (0 for data pages; 0xFFFFFFFF for header pages)
): Buffer {
  // Lacing table (255-byte segments)
  const lace: number[] = []
  let rem = pkt.length
  while (rem >= 255) { lace.push(255); rem -= 255 }
  lace.push(rem)

  const hdr = Buffer.alloc(27 + lace.length)
  hdr.write('OggS', 0, 'ascii')
  hdr[4] = 0; hdr[5] = headerType
  // 64-bit LE granule position
  hdr.writeUInt32LE(granuleLo >>> 0, 6)
  hdr.writeUInt32LE(granuleHi >>> 0, 10)
  hdr.writeUInt32LE(serial, 14)
  hdr.writeUInt32LE(seq, 18)
  hdr.writeUInt32LE(0, 22)       // checksum — filled after CRC
  hdr[26] = lace.length
  lace.forEach((v, i) => { hdr[27 + i] = v })

  const page = Buffer.concat([hdr, pkt])
  page.writeUInt32LE(oggCrc32(page), 22)
  return page
}

function buildOpusHead(channels: number, inputSampleRate: number): Buffer {
  const b = Buffer.alloc(19)
  b.write('OpusHead', 0, 'ascii')
  b[8] = 1           // version
  b[9] = channels
  b.writeUInt16LE(312, 10)            // pre-skip (312 samples @ 48 kHz)
  b.writeUInt32LE(inputSampleRate, 12)
  b.writeUInt16LE(0, 16)             // output gain
  b[18] = 0                          // channel mapping family: mono/stereo
  return b
}

function buildOpusTags(): Buffer {
  const vendor = Buffer.from('webm-remux')
  const b = Buffer.alloc(8 + 4 + vendor.length + 4)
  b.write('OpusTags', 0, 'ascii')
  b.writeUInt32LE(vendor.length, 8)
  vendor.copy(b, 12)
  b.writeUInt32LE(0, 12 + vendor.length) // zero user comments
  return b
}

/**
 * Minimal EBML parser — extracts the raw Opus payload bytes
 * from every SimpleBlock in the WebM file.
 */
function extractOpusPackets(webm: Buffer): Buffer[] {
  const packets: Buffer[] = []
  let p = 0

  // EBML VINT for element sizes (masks the leading 1-bit)
  function readVintSize(): number {
    if (p >= webm.length) return -1
    const b = webm[p]
    let w = 1; let mask = 0x80
    while (mask > 0 && !(b & mask)) { w++; mask >>= 1 }
    if (w > 8 || p + w > webm.length) return -1
    let v = b & ~mask
    for (let i = 1; i < w; i++) v = v * 256 + webm[p + i]
    p += w
    // Unknown size (all data bits = 1) → treat as "recurse into element"
    return v === Math.pow(2, 7 * w) - 1 ? -1 : v
  }

  // EBML element ID (keeps the leading 1-bit)
  function readId(): number {
    if (p >= webm.length) return -1
    const b = webm[p]
    let w = 1; let mask = 0x80
    while (mask > 0 && !(b & mask)) { w++; mask >>= 1 }
    if (w > 4 || p + w > webm.length) return -1
    let id = 0
    for (let i = 0; i < w; i++) id = id * 256 + webm[p + i]
    p += w
    return id >>> 0
  }

  // Container elements to recurse into rather than skip
  const RECURSE = new Set([
    0x18538067, // Segment
    0x1F43B675, // Cluster
  ])

  while (p < webm.length) {
    const id = readId()
    if (id === -1) break
    const size = readVintSize()

    if (id === 0xA3 && size > 0) {
      // SimpleBlock body: TrackNum (VINT) | TimeCode (2 bytes) | Flags (1 byte) | Data
      const bodyStart = p
      const bodyEnd = bodyStart + size
      if (bodyEnd > webm.length) break

      // Skip TrackNum VINT
      const tnb = webm[p]
      let tnw = 1; let tnm = 0x80
      while (tnm > 0 && !(tnb & tnm)) { tnw++; tnm >>= 1 }
      p += tnw

      const flags = webm[p + 2] // byte after 2-byte timecode
      p += 3                     // skip timecode + flags

      const lacingType = (flags >> 1) & 0x3
      if (lacingType === 0 && p < bodyEnd) {
        // No lacing — single Opus frame
        packets.push(Buffer.from(webm.subarray(p, bodyEnd)))
      }
      // Laced blocks (uncommon in Chrome MediaRecorder) are skipped

      p = bodyEnd
    } else if (RECURSE.has(id) || size === -1) {
      // Recurse: don't advance p — loop continues parsing body
    } else if (size >= 0 && p + size <= webm.length) {
      p += size
    } else {
      break
    }
  }

  return packets
}

export function convertWebmToOgg(webm: Buffer): Buffer {
  const packets = extractOpusPackets(webm)
  console.log(`[webm-to-ogg] webm=${webm.length}B packets=${packets.length} sizes=${packets.slice(0,3).map(p=>p.length).join(',')}`)
  if (packets.length === 0) throw new Error('[webm-to-ogg] no Opus packets found in WebM')

  const serial = Math.floor(Math.random() * 0xffffffff)
  const pages: Buffer[] = []

  // RFC 7845: granule position of header pages MUST be -1 (all 64 bits set)
  pages.push(makeOggPage(0x02, 0xffffffff, serial, 0, buildOpusHead(1, 48000), 0xffffffff))
  pages.push(makeOggPage(0x00, 0xffffffff, serial, 1, buildOpusTags(),          0xffffffff))

  // Data pages — one packet per page
  // Assume 20 ms frames (960 samples @ 48 kHz); typical for Chrome MediaRecorder
  const FRAME_SAMPLES = 960
  let granule = 0
  for (let i = 0; i < packets.length; i++) {
    granule += FRAME_SAMPLES
    const isLast = i === packets.length - 1
    pages.push(makeOggPage(isLast ? 0x04 : 0x00, granule, serial, i + 2, packets[i]))
  }

  return Buffer.concat(pages)
}
