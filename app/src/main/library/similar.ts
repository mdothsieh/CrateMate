/**
 * library/similar.ts — the v1 similarity engine: "what mixes with this track?"
 *
 * Score = weighted blend of four signals (ALL soft — no hard filters, per the
 * PLAN.md genre-culture caveat: open-format/KPOP sets break harmonic-mixing
 * rules on purpose, so nothing is ever excluded outright, only down-ranked):
 *
 *   style   0.45  cosine similarity of Discogs-EffNet embeddings ("same vibe")
 *   bpm     0.30  tempo proximity — half/double-time counts as the same groove
 *   key     0.15  Camelot compatibility (same number, or ±1 same ring)
 *   energy  0.10  RMS-loudness proximity
 *
 * These weights are v1 defaults. The eval harness (next ⭐ item) exists to
 * tune them against the user's own labeled pairs instead of by vibes.
 */
import { getDb } from './db'
import { camelotCompatible } from '../../shared/camelot'

export const WEIGHTS = { style: 0.45, bpm: 0.3, key: 0.15, energy: 0.1 }

export interface TrackSummary {
  id: number
  path: string
  filename: string
  title: string | null
  artist: string | null
  durationS: number | null
  bpm: number | null
  camelot: string | null
  energyDb: number | null
  bpmKeySource: string | null
}

export interface SimilarMatch extends TrackSummary {
  score: number
  /** human-readable WHY, shown in the UI — e.g. "vibe 87%", "126 → 124 BPM" */
  reasons: string[]
}

interface CandidateRow extends TrackSummary {
  embedding: Buffer | null
}

/**
 * Same-song detector (v1 track identity, PLAN.md → Track Identity):
 * normalized artist+title — strips downloader junk like "(SPOTISAVER)" or
 * "[NotSlider.nl]", punctuation, and case. Chromaprint fingerprinting is the
 * Phase 4 upgrade; this catches the common duplicate-download case.
 */
function identityKey(t: { artist: string | null; title: string | null; filename: string }): string {
  const raw = `${t.artist ?? ''} ${t.title ?? t.filename}`
  return raw
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')      // bracketed junk
    .replace(/\.mp3$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')      // keep letters/numbers in any script
    .trim()
}

/** BPM proximity, 0..1, testing 1x / 2x / 0.5x (half/double-time = same groove). */
function bpmScore(a: number | null, b: number | null): { score: number; shownMult: number } {
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

function keyScore(a: string | null, b: string | null): number {
  if (!a || !b) return 0.5
  if (a === b) return 1
  return camelotCompatible(a, b) ? 0.85 : 0
}

function energyScore(a: number | null, b: number | null): number {
  if (a == null || b == null) return 0.5
  return Math.max(0, 1 - Math.abs(a - b) / 6) // 6 dB apart = nothing in common
}

function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s // embeddings are L2-normalized at analysis time
}

export function findSimilar(queryPath: string, topN = 5): { query: TrackSummary; matches: SimilarMatch[] } {
  const db = getDb()
  const cols = 'id, path, filename, title, artist, durationS, bpm, camelot, energyDb, bpmKeySource, embedding'
  const query = db.prepare(`SELECT ${cols} FROM tracks WHERE path = ?`).get(queryPath) as CandidateRow | undefined
  if (!query) throw new Error('track not found in index')
  if (!query.embedding) throw new Error('track has no embedding yet')

  const qEmb = new Float32Array(query.embedding.buffer, query.embedding.byteOffset, query.embedding.length / 4)
  const qIdentity = identityKey(query)

  const candidates = db.prepare(`SELECT ${cols} FROM tracks WHERE embedding IS NOT NULL AND id != ?`)
    .all(query.id) as CandidateRow[]

  const scored: SimilarMatch[] = []
  const seenIdentity = new Set<string>([qIdentity]) // never suggest the same song back

  // Sort by score AFTER computing all, then dedupe same-song variants keeping the best
  const all = candidates.map((c) => {
    const cEmb = new Float32Array(c.embedding!.buffer, c.embedding!.byteOffset, c.embedding!.length / 4)
    const style = (cosine(qEmb, cEmb) + 1) / 2 // [-1,1] → [0,1]
    const bpm = bpmScore(query.bpm, c.bpm)
    const key = keyScore(query.camelot, c.camelot)
    const energy = energyScore(query.energyDb, c.energyDb)
    const score = WEIGHTS.style * style + WEIGHTS.bpm * bpm.score + WEIGHTS.key * key + WEIGHTS.energy * energy

    const reasons: string[] = []
    reasons.push(`vibe ${Math.round(style * 100)}%`)
    if (query.bpm && c.bpm && bpm.score > 0.3) {
      reasons.push(bpm.shownMult === 1
        ? `${Math.round(query.bpm)} → ${Math.round(c.bpm)} BPM`
        : `${Math.round(query.bpm)} → ${Math.round(c.bpm)} BPM (half/double)`)
    }
    if (query.camelot && c.camelot && key > 0) {
      reasons.push(query.camelot === c.camelot ? `same key ${c.camelot}` : `${query.camelot} → ${c.camelot} compatible`)
    }
    if (energy > 0.7) reasons.push('similar energy')

    const { embedding: _drop, ...summary } = c
    return { ...summary, score, reasons }
  }).sort((a, b) => b.score - a.score)

  for (const m of all) {
    const ident = identityKey(m)
    if (seenIdentity.has(ident)) continue
    seenIdentity.add(ident)
    scored.push(m)
    if (scored.length >= topN) break
  }

  const { embedding: _q, ...querySummary } = query
  return { query: querySummary, matches: scored }
}
