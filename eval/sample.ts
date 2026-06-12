/**
 * eval/sample.ts — build the unlabeled eval set (eval/pairs.json).
 *
 *   node eval/sample.ts [--n 10] [--seed 42]
 *
 * Query selection: if eval/queries.txt exists (one search term per line,
 * matched case-insensitively against artist/title/filename), those become
 * the queries — that's how the user steers the set toward his real genres
 * (KPOP / C-pop / open-format). Otherwise: seeded-random pick of N tracks.
 *
 * Per query we emit:
 *   - the engine's CURRENT top-5 (these are what precision@5 judges), plus
 *   - 2 seeded-random non-top-5 candidates as realistic negatives — needed so
 *     weight tuning has labeled pairs the current ranking did NOT pick
 *     (otherwise re-ranking could only ever shuffle known-good pairs).
 *
 * ~10 queries × (5 + 2) ≈ 70 pairs, inside PLAN.md's 30–50+ labeling budget.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEIGHTS, rankCandidates, identityKey } from '../app/src/shared/scoring.ts'
import {
  EVAL_DIR, PAIRS_PATH, loadTracks, displayName, mulberry32, writeJsonAtomic,
  type EvalTrack, type QueryPairs, type PairCandidate,
} from './lib.ts'

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}

const N_QUERIES = arg('n', 10)
const SEED = arg('seed', 42)
const RANDOM_NEGATIVES_PER_QUERY = 2

const tracks = loadTracks()
console.log(`library: ${tracks.length} embedded tracks`)

// --- pick queries ---------------------------------------------------------
const queriesTxt = join(EVAL_DIR, 'queries.txt')
let queries: EvalTrack[] = []

if (existsSync(queriesTxt)) {
  const terms = readFileSync(queriesTxt, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  for (const term of terms) {
    const t = term.toLowerCase()
    const hit = tracks.find(
      (tr) => tr.path.toLowerCase().includes(t)
        || (tr.title ?? '').toLowerCase().includes(t)
        || (tr.artist ?? '').toLowerCase().includes(t)
        || tr.filename.toLowerCase().includes(t),
    )
    if (hit) queries.push(hit)
    else console.warn(`  no match for query term: "${term}"`)
  }
  console.log(`queries: ${queries.length} from queries.txt`)
} else {
  // Seeded shuffle (Fisher–Yates), then take N with distinct song identities
  // so two copies of the same track can't both become queries.
  const rng = mulberry32(SEED)
  const pool = [...tracks]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const seen = new Set<string>()
  for (const t of pool) {
    const id = identityKey(t)
    if (seen.has(id)) continue
    seen.add(id)
    queries.push(t)
    if (queries.length >= N_QUERIES) break
  }
  console.log(`queries: ${queries.length} seeded-random (seed ${SEED}) — add eval/queries.txt to hand-pick instead`)
}

// --- build pairs -----------------------------------------------------------
const rng = mulberry32(SEED ^ 0x9e3779b9) // decorrelate from the query shuffle
const out: QueryPairs[] = []

for (const q of queries) {
  const candidates = tracks.filter((t) => t.id !== q.id)
  const top5 = rankCandidates(q, candidates, WEIGHTS, 5)

  const taken = new Set<string>([q.path, ...top5.map((m) => m.track.path)])
  const takenIdent = new Set<string>([identityKey(q), ...top5.map((m) => identityKey(m.track))])
  const negatives: EvalTrack[] = []
  while (negatives.length < RANDOM_NEGATIVES_PER_QUERY) {
    const pick = candidates[Math.floor(rng() * candidates.length)]
    if (taken.has(pick.path) || takenIdent.has(identityKey(pick))) continue
    taken.add(pick.path)
    takenIdent.add(identityKey(pick))
    negatives.push(pick)
  }

  const toCandidate = (t: EvalTrack, source: PairCandidate['source'], rank?: number): PairCandidate => ({
    path: t.path, name: displayName(t), bpm: t.bpm, camelot: t.camelot, durationS: t.durationS, source, rank,
  })

  out.push({
    queryPath: q.path,
    name: displayName(q),
    bpm: q.bpm,
    camelot: q.camelot,
    durationS: q.durationS,
    candidates: [
      ...top5.map((m, i) => toCandidate(m.track, 'top5', i + 1)),
      ...negatives.map((t) => toCandidate(t, 'random')),
    ],
  })
}

writeJsonAtomic(PAIRS_PATH, out)
const nPairs = out.reduce((s, q) => s + q.candidates.length, 0)
console.log(`wrote ${PAIRS_PATH}: ${out.length} queries, ${nPairs} pairs to label`)
console.log('next: node eval/label.ts')
