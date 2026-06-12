/**
 * eval/label.ts — interactive terminal labeling of eval/pairs.json.
 *
 *   node eval/label.ts
 *
 * For each pair: would you mix these two tracks in a real set?
 *   (1) preview query   (2) preview candidate   (y) mix well
 *   (n) don't           (s) skip                (q) quit (resumable)
 *
 * Preview = 15s starting ~60s in (intros lie; the groove lives past the
 * first minute). afplay can't seek, so we cut the snippet with the app's
 * own ffmpeg-static binary into a temp wav first; if ffmpeg is missing we
 * fall back to afplay-ing the first 20s of the file directly.
 *
 * Labels append to eval/labels.json after EVERY answer (atomic write), so
 * quitting and resuming never loses work. The labeling question is framed
 * by PLAN.md's genre-culture caveat: label how YOU actually transition
 * (cuts, doubles, vocal energy) — not textbook harmonic rules.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emitKeypressEvents } from 'node:readline'
import {
  EVAL_DIR, LABELS_PATH, readPairs, readLabelRecords, pairKey, writeJsonAtomic,
  type LabelRecord, type LabelValue, type PairCandidate, type QueryPairs,
} from './lib.ts'

const FFMPEG = join(EVAL_DIR, '..', 'app', 'node_modules', 'ffmpeg-static', 'ffmpeg')
const PREVIEW_WAV = join(tmpdir(), 'cratemate-eval-preview.wav')
const PREVIEW_LEN_S = 15

let playing: ChildProcess | null = null
let cutting: ChildProcess | null = null

function stopAudio(): void {
  cutting?.kill('SIGKILL')
  cutting = null
  playing?.kill('SIGKILL')
  playing = null
}

function preview(path: string, durationS: number | null): void {
  stopAudio()
  if (!existsSync(FFMPEG)) {
    playing = spawn('afplay', ['-t', '20', path], { stdio: 'ignore' }) // fallback: first 20s
    return
  }
  // Seek to 60s, or a third of the way in for short tracks.
  const seek = durationS && durationS < 90 ? Math.max(0, durationS / 3) : 60
  // argv array — paths are never interpolated through a shell.
  const ff = spawn(FFMPEG, ['-y', '-ss', String(seek), '-t', String(PREVIEW_LEN_S), '-i', path, PREVIEW_WAV], { stdio: 'ignore' })
  cutting = ff
  ff.on('exit', (code) => {
    if (cutting !== ff) return // superseded by a newer preview request
    cutting = null
    if (code === 0) playing = spawn('afplay', [PREVIEW_WAV], { stdio: 'ignore' })
  })
}

// --- collect unlabeled pairs ------------------------------------------------
const pairs = readPairs()
const records: LabelRecord[] = readLabelRecords()
const done = new Set(records.map((r) => pairKey(r.queryPath, r.candidatePath)))

interface Job { query: QueryPairs; candidate: PairCandidate }
const jobs: Job[] = []
for (const q of pairs) for (const c of q.candidates) {
  if (!done.has(pairKey(q.queryPath, c.path))) jobs.push({ query: q, candidate: c })
}

const total = pairs.reduce((s, q) => s + q.candidates.length, 0)
if (jobs.length === 0) {
  console.log(`all ${total} pairs labeled — run: node eval/metrics.ts`)
  process.exit(0)
}
console.log(`${total - jobs.length}/${total} labeled, ${jobs.length} to go`)
console.log('Question per pair: would YOU mix these two in a real set? (your style — cuts and doubles count)\n')

// --- key loop ----------------------------------------------------------------
function fmt(name: string, bpm: number | null, camelot: string | null): string {
  const meta = [bpm ? `${Math.round(bpm)} BPM` : null, camelot].filter(Boolean).join(', ')
  return meta ? `${name}  (${meta})` : name
}

let i = 0
function show(): void {
  const { query, candidate } = jobs[i]
  const src = candidate.source === 'top5' ? `top5 #${candidate.rank}` : 'random'
  console.log(`[${total - jobs.length + i + 1}/${total}]`)
  console.log(`  QUERY  ${fmt(query.name, query.bpm, query.camelot)}`)
  console.log(`  CAND   ${fmt(candidate.name, candidate.bpm, candidate.camelot)}   [${src}]`)
  console.log('  (1) play query  (2) play candidate  (y) mix well  (n) don\'t  (s) skip  (q) quit')
}

function record(label: LabelValue): void {
  const { query, candidate } = jobs[i]
  records.push({ queryPath: query.queryPath, candidatePath: candidate.path, label, labeledAt: new Date().toISOString() })
  writeJsonAtomic(LABELS_PATH, records)
}

function finish(msg: string): never {
  stopAudio()
  try { unlinkSync(PREVIEW_WAV) } catch { /* never existed */ }
  process.stdin.setRawMode(false)
  process.stdin.pause()
  console.log(msg)
  process.exit(0)
}

emitKeypressEvents(process.stdin)
process.stdin.setRawMode(true)
process.stdin.resume()
show()

process.stdin.on('keypress', (_str: string, key: { name?: string; sequence?: string }) => {
  const { query, candidate } = jobs[i]
  switch (key.sequence === '\u0003' ? 'q' : key.name) { // Ctrl+C = quit
    case '1': preview(query.queryPath, query.durationS); return
    case '2': preview(candidate.path, candidate.durationS); return
    case 'y': record('mix'); break
    case 'n': record('no'); break
    case 's': record('skip'); break
    case 'q': finish(`paused — ${records.length} labels saved, resume with: node eval/label.ts`)
    default: return // any other key: ignore
  }
  stopAudio()
  i++
  if (i >= jobs.length) finish(`done — all pairs labeled (${LABELS_PATH})\nnext: node eval/metrics.ts`)
  console.log()
  show()
})
