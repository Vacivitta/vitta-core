// Etapa 3 — copia os arquivos do Storage (origem → VPS) pela API do Supabase.
// Enviar pela API (e não copiar arquivos/linhas direto) faz o Storage do destino
// gravar o arquivo no MinIO e registrar storage.objects do jeito dele.
//
// Uso (na pasta do projeto, para achar @supabase/supabase-js):
//   SRC_URL=https://<ref>.supabase.co SRC_SERVICE_KEY=... \
//   DST_URL=https://<supabase-da-vps> DST_SERVICE_KEY=... \
//   node scripts/migracao-vps/04-copiar-storage.mjs
//
// É idempotente: arquivos que já existem no destino são pulados, então pode ser
// rodado de novo na hora da troca para copiar só o que chegou depois.

import { createClient } from '@supabase/supabase-js'

const { SRC_URL, SRC_SERVICE_KEY, DST_URL, DST_SERVICE_KEY } = process.env
if (!SRC_URL || !SRC_SERVICE_KEY || !DST_URL || !DST_SERVICE_KEY) {
  console.error('Defina SRC_URL, SRC_SERVICE_KEY, DST_URL e DST_SERVICE_KEY')
  process.exit(1)
}

const src = createClient(SRC_URL, SRC_SERVICE_KEY, { auth: { persistSession: false } })
const dst = createClient(DST_URL, DST_SERVICE_KEY, { auth: { persistSession: false } })

/** Lista todos os arquivos de um bucket, descendo nas "pastas". */
async function listAll(client, bucket, prefix = '') {
  const files = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset })
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`)
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id === null) files.push(...await listAll(client, bucket, path)) // pasta
      else files.push({ path, mimetype: item.metadata?.mimetype })
    }
    if (data.length < 1000) break
  }
  return files
}

const { data: buckets, error: bErr } = await src.storage.listBuckets()
if (bErr) throw bErr

let copied = 0, skipped = 0, failed = 0
for (const bucket of buckets) {
  // Bucket já vem do dump (04_storage_buckets.sql); garante caso não exista
  await dst.storage.createBucket(bucket.id, {
    public: bucket.public,
    fileSizeLimit: bucket.file_size_limit ?? undefined,
    allowedMimeTypes: bucket.allowed_mime_types ?? undefined,
  }).catch(() => {})

  const files = await listAll(src, bucket.id)
  const existing = new Set((await listAll(dst, bucket.id)).map(f => f.path))
  console.log(`[${bucket.id}] ${files.length} arquivos (${existing.size} já no destino)`)

  for (const f of files) {
    if (existing.has(f.path)) { skipped++; continue }
    const { data: blob, error: dErr } = await src.storage.from(bucket.id).download(f.path)
    if (dErr) { failed++; console.error(`  download ${f.path}: ${dErr.message}`); continue }
    const { error: uErr } = await dst.storage.from(bucket.id).upload(f.path, blob, {
      contentType: f.mimetype ?? blob.type ?? 'application/octet-stream',
      upsert: false,
    })
    if (uErr) { failed++; console.error(`  upload ${f.path}: ${uErr.message}`); continue }
    if (++copied % 100 === 0) console.log(`  ${copied} copiados...`)
  }
}

console.log(`Concluído: ${copied} copiados, ${skipped} já existiam, ${failed} falhas`)
process.exit(failed ? 1 : 0)
