/**
 * library/similar.ts — the v1 similarity engine: "what mixes with this track?"
 *
 * The actual math (weights, per-signal scores, ranking + same-song dedup)
 * lives in src/shared/scoring.ts so the eval harness (eval/ at repo root)
 * measures the EXACT code the app ships. This file is the Electron-side
 * wrapper: pull candidates from SQLite, hand them to rankCandidates(), and
 * turn the per-signal scores into the human-readable reason chips.
 */
import { getDb } from './db'
import { WEIGHTS, rankCandidates, type ScorableTrack } from '../../shared/scoring'

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

/** SQLite stores the embedding as a raw BLOB; reinterpret the bytes as floats. */
function toFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)
}

export function findSimilar(queryPath: string, topN = 5): { query: TrackSummary; matches: SimilarMatch[] } {
  const db = getDb()
  const cols = 'id, path, filename, title, artist, durationS, bpm, camelot, energyDb, bpmKeySource, embedding'
  const query = db.prepare(`SELECT ${cols} FROM tracks WHERE path = ?`).get(queryPath) as CandidateRow | undefined
  if (!query) throw new Error('track not found in index')
  if (!query.embedding) throw new Error('track has no embedding yet')

  const candidates = db.prepare(`SELECT ${cols} FROM tracks WHERE embedding IS NOT NULL AND id != ?`)
    .all(query.id) as CandidateRow[]

  // Row → ScorableTrack: same object plus the decoded embedding (the row's
  // other fields ride along so we can build TrackSummary back afterwards).
  type Scorable = TrackSummary & ScorableTrack
  const q: Scorable = { ...query, embedding: toFloat32(query.embedding) }
  const ranked = rankCandidates<Scorable>(
    q,
    candidates.map((c) => ({ ...c, embedding: toFloat32(c.embedding!) })),
    WEIGHTS,
    topN,
  )

  const matches: SimilarMatch[] = ranked.map(({ track, score, parts, bpmMult }) => {
    const reasons: string[] = []
    reasons.push(`vibe ${Math.round(parts.style * 100)}%`)
    if (query.bpm && track.bpm && parts.bpm > 0.3) {
      reasons.push(bpmMult === 1
        ? `${Math.round(query.bpm)} → ${Math.round(track.bpm)} BPM`
        : `${Math.round(query.bpm)} → ${Math.round(track.bpm)} BPM (half/double)`)
    }
    if (query.camelot && track.camelot && parts.key > 0) {
      reasons.push(query.camelot === track.camelot ? `same key ${track.camelot}` : `${query.camelot} → ${track.camelot} compatible`)
    }
    if (parts.energy > 0.7) reasons.push('similar energy')

    const { embedding: _drop, ...summary } = track
    return { ...summary, score, reasons }
  })

  const { embedding: _q, ...querySummary } = query
  return { query: querySummary, matches }
}
