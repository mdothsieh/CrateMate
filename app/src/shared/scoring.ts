/**
 * scoring.ts — the pure similarity math, extracted from main/library/similar.ts
 * so the eval harness (eval/ at repo root) can score with the EXACT code the
 * app ships. One implementation, two consumers — if they ever diverged, the
 * eval would measure a different engine than the one users see.
 *
 * Pure = no DB, no Electron, no Node APIs. That's also what lets plain
 * `node` (via native TypeScript type-stripping) import this file directly.
 *
 * NOTE the explicit `.ts` import extension below: Node's type-stripping
 * resolves modules like ESM (full filename required), while the app's
 * bundler accepts either. tsconfig sets `allowImportingTsExtensions`.
 */
import { camelotCompatible } from './camelot.ts'

/**
 * v1 default weights — ALL soft, no hard filters (PLAN.md genre-culture
 * caveat: open-format/KPOP sets break harmonic-mixing rules on purpose, so
 * nothing is excluded outright, only down-ranked). The eval harness exists
 * to tune these against the user's own labeled pairs instead of by vibes.
 *
 *   style   0.45  cosine similarity of Discogs-EffNet embeddings ("same vibe")
 *   bpm     0.30  tempo proximity — half/double-time counts as the same groove
 *   key     0.15  Camelot compatibility (same number, or ±1 same ring)
 *   energy  0.10  RMS-loudness proximity
 */
export const WEIGHTS = { style: 0.45, bpm: 0.3, key: 0.15, energy: 0.1 }
export type Weights = typeof WEIGHTS

/** The minimum a track must carry to be scored. Embedding is required —
 *  tracks without one are filtered out before ranking, same as the app. */
export interface ScorableTrack {
  filename: string
  title: string | null
  artist: string | null
  bpm: number | null
  camelot: string | null
  energyDb: number | null
  embedding: Float32Array
}

export interface PairScore {
  /** weighted blend, 0..1 */
  score: number
  /** per-signal scores BEFORE weighting — the UI's reason chips and the
   *  eval's harmonic/BPM rates both read these */
  parts: { style: number; bpm: number; key: number; energy: number }
  /** which tempo relation won: 1 = straight, 2 / 0.5 = half/double-time */
  bpmMult: number
}

/**
 * Same-song detector (v1 track identity, PLAN.md → Track Identity):
 * normalized artist+title — strips downloader junk like "(SPOTISAVER)" or
 * "[NotSlider.nl]", punctuation, and case. Chromaprint fingerprinting is the
 * Phase 4 upgrade; this catches the common duplicate-download case.
 */
export function identityKey(t: { artist: string | null; title: string | null; filename: string }): string {
  const raw = `${t.artist ?? ''} ${t.title ?? t.filename}`
  return raw
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')      // bracketed junk
    .replace(/\.mp3$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')      // keep letters/numbers in any script
    .trim()
}

/** BPM proximity, 0..1, testing 1x / 2x / 0.5x (half/double-time = same groove). */
export function bpmScore(a: number | null, b: number | null): { score: number; shownMult: number } {
  if (!a || !b) return { score: 0.5, shownMult: 1 } // unknown ≠ incompatible
  let best = 0
  let bestMult = 1
  for (const mult of [1, 2, 0.5]) {
    const rel = Math.abs(a * mult - b) / b
    const s = Math.max(0, 1 - rel / 0.08) // 0 points at 8% apart
    if (s > best) { best = s; bestMult = mult }
  }
  return { score: best, shownMult: bestMult }
}

export function keyScore(a: string | null, b: string | null): number {
  if (!a || !b) return 0.5
  if (a === b) return 1
  return camelotCompatible(a, b) ? 0.85 : 0
}

export function energyScore(a: number | null, b: number | null): number {
  if (a == null || b == null) return 0.5
  return Math.max(0, 1 - Math.abs(a - b) / 6) // 6 dB apart = nothing in common
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s // embeddings are L2-normalized at analysis time
}

/** Score one candidate against the query. The weighted blend the app ranks by. */
export function scorePair(query: ScorableTrack, candidate: ScorableTrack, weights: Weights = WEIGHTS): PairScore {
  const style = (cosine(query.embedding, candidate.embedding) + 1) / 2 // [-1,1] → [0,1]
  const bpm = bpmScore(query.bpm, candidate.bpm)
  const key = keyScore(query.camelot, candidate.camelot)
  const energy = energyScore(query.energyDb, candidate.energyDb)
  return {
    score: weights.style * style + weights.bpm * bpm.score + weights.key * key + weights.energy * energy,
    parts: { style, bpm: bpm.score, key, energy },
    bpmMult: bpm.shownMult,
  }
}

export interface RankedCandidate<T extends ScorableTrack> extends PairScore {
  track: T
}

/**
 * The full ranking pipeline: score every candidate, sort descending, then
 * dedupe same-song variants keeping the best-scoring one. The query's own
 * identity is seeded into the seen-set so the same song is never suggested
 * back. This is THE ranking the app shows and the eval measures.
 */
export function rankCandidates<T extends ScorableTrack>(
  query: T,
  candidates: T[],
  weights: Weights = WEIGHTS,
  topN = 5,
): RankedCandidate<T>[] {
  const all = candidates
    .map((track) => ({ track, ...scorePair(query, track, weights) }))
    .sort((a, b) => b.score - a.score)

  const seenIdentity = new Set<string>([identityKey(query)])
  const top: RankedCandidate<T>[] = []
  for (const m of all) {
    const ident = identityKey(m.track)
    if (seenIdentity.has(ident)) continue
    seenIdentity.add(ident)
    top.push(m)
    if (top.length >= topN) break
  }
  return top
}
