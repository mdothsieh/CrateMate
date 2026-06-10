/**
 * library/indexer.ts — orchestrates a full (incremental) library index:
 *
 *   scan folder for .mp3 ─▶ skip files already indexed (path+mtime+size match)
 *   load Serato database V2 once ─▶ BPM/key import map
 *   spawn N analysis workers ─▶ each file: embedding+energy (+BPM/key fallback)
 *   write rows to SQLite ─▶ stream progress events to the UI after every file
 *
 * Design notes:
 *  - MP3-only by user decision (PLAN.md Decision Log) — one decode path.
 *  - Worker count scales with cores but caps at 4: each worker holds its own
 *    WASM heap + ONNX session (~hundreds of MB together), and the first-run
 *    projection (~10–15 min for ~1,700 files) is already acceptable.
 *  - Skipped/corrupt files are counted and reported, never fatal.
 */
import { utilityProcess, app, type UtilityProcess } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { loadSeratoAnalysis } from '../serato/database'
import { toCamelot } from '../../shared/camelot'
import { isUpToDate, upsertTrack, setMeta } from './db'
import type { IndexProgress } from '../../shared/ipc'

interface WorkerResult {
  type: 'result' | 'fail' | 'ready'
  id: number
  durationS?: number
  energyDb?: number
  embedding?: number[]
  bpm?: number | null
  key?: string | null
  message?: string
}

let indexRunning = false

export function isIndexRunning(): boolean {
  return indexRunning
}

/** Recursively collect .mp3 paths (ignores dotfiles and the Serato Stems cache dirs). */
function scanMp3s(folder: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return // unreadable dir: skip, don't die
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile() && e.name.toLowerCase().endsWith('.mp3')) out.push(full)
    }
  }
  walk(folder)
  return out
}

/** "Artist - Title.mp3" → { artist, title } best-effort fallback when Serato has neither. */
function guessFromFilename(file: string): { artist: string | null; title: string | null } {
  const base = path.basename(file, path.extname(file))
  const m = base.match(/^(.{2,60}?)\s+-\s+(.+)$/)
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: null, title: base }
}

/**
 * Analyze ONE file on demand — for when the user drops a track that isn't in
 * the index yet (e.g. a brand-new download). Spawns a single worker, waits,
 * writes the row, kills the worker. Takes ~3–6 s.
 */
export async function analyzeSingleFile(file: string): Promise<void> {
  const st = fs.statSync(file)
  if (isUpToDate(file, st.mtimeMs, st.size)) return // already indexed & unchanged

  const modelPath = path.join(app.getAppPath(), 'models', 'discogs-effnet-bsdynamic-1.onnx')
  const workerPath = path.join(__dirname, 'analysis-worker.js')
  const serato = loadSeratoAnalysis()
  const s = serato.get(file)
  const useSerato = s?.bpm != null && s?.camelot != null

  const msg = await new Promise<WorkerResult>((resolve, reject) => {
    const w = utilityProcess.fork(workerPath)
    const timeout = setTimeout(() => { w.kill(); reject(new Error('analysis timed out (60s)')) }, 60_000)
    w.on('message', (m: WorkerResult) => {
      if (m.type === 'ready') w.postMessage({ type: 'job', id: 0, path: file, needsBpmKey: !useSerato })
      else { clearTimeout(timeout); w.kill(); m.type === 'result' ? resolve(m) : reject(new Error(m.message)) }
    })
    w.on('exit', () => { clearTimeout(timeout); reject(new Error('analysis worker crashed')) })
    w.postMessage({ type: 'init', modelPath })
  })

  const guess = guessFromFilename(file)
  upsertTrack({
    path: file,
    filename: path.basename(file),
    title: s?.title ?? guess.title,
    artist: s?.artist ?? guess.artist,
    durationS: msg.durationS ?? null,
    bpm: useSerato ? s!.bpm : (msg.bpm ?? null),
    keyRaw: useSerato ? s!.key : (msg.key ?? null),
    camelot: useSerato ? s!.camelot : toCamelot(msg.key),
    bpmKeySource: useSerato ? 'serato' : (msg.bpm != null ? 'essentia' : null),
    energyDb: msg.energyDb ?? null,
    embedding: msg.embedding ? Buffer.from(new Float32Array(msg.embedding).buffer) : null,
    fileMtimeMs: st.mtimeMs,
    fileSize: st.size,
    analyzedAt: Date.now(),
  })
}

export async function runIndex(
  folder: string,
  onProgress: (p: IndexProgress) => void
): Promise<void> {
  if (indexRunning) throw new Error('index already running')
  indexRunning = true
  const startedAt = Date.now()
  const elapsed = (): number => Date.now() - startedAt

  try {
    onProgress({ phase: 'scanning', done: 0, total: 0, skipped: 0, errors: 0, elapsedMs: 0 })

    const allFiles = scanMp3s(folder)
    const serato = loadSeratoAnalysis()

    // Incremental: only analyze files that are new or changed since last run
    const pending: string[] = []
    let skipped = 0
    for (const f of allFiles) {
      const st = fs.statSync(f)
      if (isUpToDate(f, st.mtimeMs, st.size)) skipped++
      else pending.push(f)
    }

    const total = allFiles.length
    let done = skipped
    let errors = 0
    onProgress({ phase: 'analyzing', done, total, skipped, errors, elapsedMs: elapsed() })

    if (pending.length > 0) {
      const modelPath = path.join(app.getAppPath(), 'models', 'discogs-effnet-bsdynamic-1.onnx')
      if (!fs.existsSync(modelPath)) {
        throw new Error(`embedding model missing at ${modelPath} — run: node scripts/fetch-models.mjs`)
      }
      const workerPath = path.join(__dirname, 'analysis-worker.js')
      const nWorkers = Math.max(1, Math.min(4, os.cpus().length - 2, pending.length))

      let next = 0
      await new Promise<void>((resolve, reject) => {
        const workers: UtilityProcess[] = []
        let liveWorkers = 0

        const finishIfDone = (): void => {
          if (done >= total) {
            workers.forEach((w) => w.kill())
            resolve()
          }
        }

        const feed = (w: UtilityProcess): void => {
          if (next >= pending.length) return finishIfDone()
          const file = pending[next]
          const id = next
          next++
          const hasSerato = serato.get(file)?.bpm != null && serato.get(file)?.camelot != null
          w.postMessage({ type: 'job', id, path: file, needsBpmKey: !hasSerato })
        }

        for (let i = 0; i < nWorkers; i++) {
          const w = utilityProcess.fork(workerPath)
          workers.push(w)
          liveWorkers++

          w.on('message', (msg: WorkerResult) => {
            if (msg.type === 'ready') return feed(w)

            const file = pending[msg.id]
            if (msg.type === 'result') {
              const s = serato.get(file)
              const guess = guessFromFilename(file)
              const st = fs.statSync(file)
              const useSerato = s?.bpm != null && s?.camelot != null
              upsertTrack({
                path: file,
                filename: path.basename(file),
                title: s?.title ?? guess.title,
                artist: s?.artist ?? guess.artist,
                durationS: msg.durationS ?? null,
                bpm: useSerato ? s!.bpm : (msg.bpm ?? null),
                keyRaw: useSerato ? s!.key : (msg.key ?? null),
                camelot: useSerato ? s!.camelot : toCamelot(msg.key),
                bpmKeySource: useSerato ? 'serato' : (msg.bpm != null ? 'essentia' : null),
                energyDb: msg.energyDb ?? null,
                embedding: msg.embedding ? Buffer.from(new Float32Array(msg.embedding).buffer) : null,
                fileMtimeMs: st.mtimeMs,
                fileSize: st.size,
                analyzedAt: Date.now(),
              })
            } else if (msg.type === 'fail') {
              errors++
            }
            done++
            onProgress({
              phase: 'analyzing', done, total, skipped, errors,
              currentFile: path.basename(file), elapsedMs: elapsed(),
            })
            if (done >= total) finishIfDone()
            else feed(w)
          })

          w.on('exit', (code) => {
            liveWorkers--
            // A worker dying mid-run (OOM, native crash) shouldn't hang indexing:
            // if all workers are gone and work remains, surface it as an error.
            if (liveWorkers === 0 && done < total) {
              reject(new Error(`all analysis workers exited (last code ${code}) with ${total - done} files left`))
            }
          })

          w.postMessage({ type: 'init', modelPath })
        }
      })
    }

    setMeta('libraryFolder', folder)
    setMeta('lastIndexedAt', String(Date.now()))
    onProgress({ phase: 'done', done, total, skipped, errors, elapsedMs: elapsed() })
  } catch (e) {
    onProgress({
      phase: 'error', done: 0, total: 0, skipped: 0, errors: 0,
      message: e instanceof Error ? e.message : String(e), elapsedMs: elapsed(),
    })
    throw e
  } finally {
    indexRunning = false
  }
}
