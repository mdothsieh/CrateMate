/**
 * analysis/worker.ts — runs as an Electron utilityProcess (a separate OS
 * process). The whole audio pipeline lives HERE, not in the main process:
 *
 *   1. a malformed/hostile MP3 can only crash this worker, never the app
 *      (PLAN.md → Security → "untrusted audio parsing in a sandboxed child")
 *   2. WASM + ONNX inference is CPU-heavy; several workers run in parallel
 *      without ever blocking the UI's IPC.
 *
 * Pipeline per file (all parameters proven in the Phase 0 spike):
 *   ffmpeg → mono PCM ── 16 kHz, middle 90 s ─▶ mel patches [n,128,96]
 *                                              ─▶ Discogs-EffNet → 1280-d embedding
 *                                              ─▶ RMS energy (dBFS)
 *          └─ 44.1 kHz, full track (only when Serato has no data for the file)
 *                                              ─▶ BPM (RhythmExtractor2013)
 *                                              ─▶ key (KeyExtractor, edmm profile)
 *
 * Protocol with the parent (indexer):
 *   parent → { type:'init', modelPath }            then one 'job' at a time
 *   parent → { type:'job', id, path, needsBpmKey }
 *   worker → { type:'ready' } | { type:'result', id, ... } | { type:'fail', id, message }
 */
import { spawnSync } from 'node:child_process'

/* eslint-disable @typescript-eslint/no-require-imports */
// These are CJS native/wasm packages; plain require keeps electron-vite from
// trying to transform them.
const ffmpegPath: string = require('ffmpeg-static')
const esPkg = require('essentia.js')
const ort = require('onnxruntime-node')

const essentia = new esPkg.Essentia(esPkg.EssentiaWASM.EssentiaWASM ?? esPkg.EssentiaWASM)

// Model frontend constants (must match how Discogs-EffNet was trained)
const EMBED_SR = 16000
const FRAME = 512
const HOP = 256
const MELS = 96
const PATCH = 128
const EMBED_DIM = 1280
const ANALYSIS_WINDOW_S = 90 // middle 90s: enough for style, ~6x faster than full track

let session: { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>; inputNames: string[] } | null = null

interface JobMsg { type: 'job'; id: number; path: string; needsBpmKey: boolean }
interface InitMsg { type: 'init'; modelPath: string }

function decodePcm(file: string, sampleRate: number): Float32Array {
  const res = spawnSync(ffmpegPath, [
    '-v', 'error', '-i', file, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1',
  ], { maxBuffer: 1024 * 1024 * 512 })
  if (res.status !== 0) throw new Error(`ffmpeg: ${res.stderr?.toString().slice(0, 200) || 'decode failed'}`)
  return new Float32Array(res.stdout.buffer, res.stdout.byteOffset, res.stdout.length / 4)
}

function middleWindow(pcm: Float32Array, sampleRate: number): Float32Array {
  const want = ANALYSIS_WINDOW_S * sampleRate
  if (pcm.length <= want) return pcm
  const start = Math.floor((pcm.length - want) / 2)
  return pcm.subarray(start, start + want)
}

/** PCM → stacked mel patches, the exact input format Discogs-EffNet expects. */
function melPatches(pcm: Float32Array): { data: Float32Array; nPatches: number } {
  const frames: Float32Array[] = []
  for (let start = 0; start + FRAME <= pcm.length; start += HOP) {
    const frameVec = essentia.arrayToVector(pcm.subarray(start, start + FRAME))
    const mel = essentia.TensorflowInputMusiCNN(frameVec)
    frames.push(essentia.vectorToArray(mel.bands))
    frameVec.delete() // WASM memory is manual — leaks crash long indexing runs
    mel.bands.delete()
  }
  const nPatches = Math.max(1, Math.floor(frames.length / PATCH))
  const data = new Float32Array(nPatches * PATCH * MELS)
  for (let p = 0; p < nPatches; p++)
    for (let f = 0; f < PATCH; f++) {
      const frame = frames[p * PATCH + f]
      if (frame) data.set(frame, (p * PATCH + f) * MELS)
    }
  return { data, nPatches }
}

async function embed(pcm16k: Float32Array): Promise<Float32Array> {
  const { data, nPatches } = melPatches(pcm16k)
  const input = new ort.Tensor('float32', data, [nPatches, PATCH, MELS])
  const out = await session!.run({ [session!.inputNames[0]]: input })
  const raw = out.embeddings.data
  // Mean-pool the per-patch embeddings, then L2-normalize → cosine == dot product
  const mean = new Float32Array(EMBED_DIM)
  for (let p = 0; p < nPatches; p++)
    for (let d = 0; d < EMBED_DIM; d++) mean[d] += raw[p * EMBED_DIM + d]
  let norm = 0
  for (let d = 0; d < EMBED_DIM; d++) { mean[d] /= nPatches; norm += mean[d] * mean[d] }
  norm = Math.sqrt(norm) || 1
  for (let d = 0; d < EMBED_DIM; d++) mean[d] /= norm
  return mean
}

/** Mean RMS loudness in dBFS — v1's "energy" feature. */
function energyDb(pcm: Float32Array): number {
  let sum = 0
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
  const rms = Math.sqrt(sum / Math.max(1, pcm.length))
  return 20 * Math.log10(Math.max(rms, 1e-10))
}

/** Full-track BPM + key — only for files Serato hasn't analyzed. */
function bpmAndKey(file: string): { bpm: number; key: string } {
  const pcm = decodePcm(file, 44100)
  const vec = essentia.arrayToVector(pcm)
  const rhythm = essentia.RhythmExtractor2013(vec)
  // 'edmm' profile: 92% mix-compatible agreement with Serato in the spike
  // (vs 62% for the default) — see SPIKE-RESULTS.md §4
  const keyRes = essentia.KeyExtractor(vec, true, 4096, 4096, 12, 3500, 60, 25, 0.2, 'edmm')
  vec.delete()
  return { bpm: rhythm.bpm, key: `${keyRes.key}${keyRes.scale === 'minor' ? 'm' : ''}` }
}

async function handleJob(msg: JobMsg): Promise<void> {
  try {
    const pcm16k = decodePcm(msg.path, EMBED_SR)
    const durationS = pcm16k.length / EMBED_SR
    const window = middleWindow(pcm16k, EMBED_SR)
    const embedding = await embed(window)
    const energy = energyDb(window)
    const extra = msg.needsBpmKey ? bpmAndKey(msg.path) : null
    process.parentPort.postMessage({
      type: 'result',
      id: msg.id,
      durationS,
      energyDb: energy,
      embedding: Array.from(embedding), // plain array survives structured clone everywhere
      bpm: extra?.bpm ?? null,
      key: extra?.key ?? null,
    })
  } catch (e) {
    process.parentPort.postMessage({ type: 'fail', id: msg.id, message: e instanceof Error ? e.message : String(e) })
  }
}

process.parentPort.on('message', (e: { data: InitMsg | JobMsg }) => {
  const msg = e.data
  if (msg.type === 'init') {
    ort.InferenceSession.create(msg.modelPath).then((s: typeof session) => {
      session = s
      process.parentPort.postMessage({ type: 'ready' })
    })
  } else if (msg.type === 'job') {
    void handleJob(msg)
  }
})
