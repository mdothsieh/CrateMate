/**
 * fetch-models.mjs — puts the embedding model in app/models/ (gitignored).
 * Tries the local Phase 0 spike copy first (instant), falls back to the
 * official Essentia models server. Run once: node scripts/fetch-models.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODEL = 'discogs-effnet-bsdynamic-1.onnx'
const destDir = path.join(__dirname, '..', 'models')
const dest = path.join(destDir, MODEL)
const spikeCopy = path.join(__dirname, '..', '..', 'spike-phase0-2026-06-10', MODEL)
const url = `https://essentia.upf.edu/models/feature-extractors/discogs-effnet/${MODEL}`

fs.mkdirSync(destDir, { recursive: true })

if (fs.existsSync(dest)) {
  console.log(`already present: ${dest}`)
} else if (fs.existsSync(spikeCopy)) {
  fs.copyFileSync(spikeCopy, dest)
  console.log(`copied from spike folder → ${dest}`)
} else {
  console.log(`downloading ${url} …`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  console.log(`downloaded → ${dest}`)
}
