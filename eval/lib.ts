/**
 * eval/lib.ts — shared plumbing for the eval harness.
 *
 * Why plain Node instead of running inside Electron: the app's better-sqlite3
 * is compiled against Electron's ABI and won't load under `node`. Node 26
 * ships its own SQLite (`node:sqlite`), so the harness reads the SAME
 * database file with zero native deps — opened READ-ONLY so a harness bug
 * can never touch the library index.
 *
 * The scoring math is imported from app/src/shared/scoring.ts — the exact
 * module the app ships — so the eval measures the real engine, not a copy.
 * (Node 26 runs .ts files natively via type stripping; that's why these
 * scripts are .ts with explicit .ts import extensions.)
 */
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { camelotCompatible } from '../app/src/shared/camelot.ts'
import type { ScorableTrack, RankedCandidate } from '../app/src/shared/scoring.ts'

export const EVAL_DIR = dirname(fileURLToPath(import.meta.url))
/** pairs.json / labels.json contain artist+title+paths from the personal
 *  library — both are gitignored (public repo); only RESULTS.md is committed. */
export const PAIRS_PATH = join(EVAL_DIR, 'pairs.json')
export const LABELS_PATH = join(EVAL_DIR, 'labels.json')
export const DB_PATH = join(homedir(), 'Library', 'Application Support', 'cratemate', 'cratemate.sqlite')

export interface EvalTrack extends ScorableTrack {
  id: number
  path: string
  durationS: number | null
}

/** All embedded tracks (the same candidate pool the app ranks over). */
export function loadTracks(dbPath: string = DB_PATH): EvalTrack[] {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const rows = db
      .prepare(
        'SELECT id, path, filename, title, artist, durationS, bpm, camelot, energyDb, embedding FROM tracks WHERE embedding IS NOT NULL',
      )
      .all() as Array<Omit<EvalTrack, 'embedding'> & { embedding: Uint8Array }>
    return rows.map((r) => ({
      ...r,
      // BLOB → floats. slice() copies to a fresh ArrayBuffer so the view is
      // 4-byte aligned regardless of where sqlite put the bytes.
      embedding: new Float32Array(r.embedding.buffer.slice(r.embedding.byteOffset, r.embedding.byteOffset + r.embedding.byteLength)),
    }))
  } finally {
    db.close()
  }
}

export function displayName(t: { artist: string | null; title: string | null; filename: string }): string {
  return t.title ? `${t.artist ?? '?'} — ${t.title}` : t.filename
}

/** Deterministic RNG (mulberry32) so `sample.ts --seed 42` always builds the
 *  same eval set — reproducibility is what makes the metric comparable run-to-run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- pairs.json / labels.json ----------

export interface PairCandidate {
  path: string
  name: string
  bpm: number | null
  camelot: string | null
  durationS: number | null
  /** 'top5' = engine suggestion (rank 1-5); 'random' = sampled negative */
  source: 'top5' | 'random'
  rank?: number
}

export interface QueryPairs {
  queryPath: string
  name: string
  bpm: number | null
  camelot: string | null
  durationS: number | null
  candidates: PairCandidate[]
}

export type LabelValue = 'mix' | 'no' | 'skip'

export interface LabelRecord {
  queryPath: string
  candidatePath: string
  label: LabelValue
  labeledAt: string
}

export function pairKey(queryPath: string, candidatePath: string): string {
  return `${queryPath}\u0000${candidatePath}` // NUL can't appear in a path
}

export function readPairs(): QueryPairs[] {
  if (!existsSync(PAIRS_PATH)) throw new Error(`no ${PAIRS_PATH} — run \`node eval/sample.ts\` first`)
  return JSON.parse(readFileSync(PAIRS_PATH, 'utf8'))
}

export function readLabelRecords(): LabelRecord[] {
  if (!existsSync(LABELS_PATH)) return []
  return JSON.parse(readFileSync(LABELS_PATH, 'utf8'))
}

export function readLabels(): Map<string, LabelValue> {
  const map = new Map<string, LabelValue>()
  for (const r of readLabelRecords()) map.set(pairKey(r.queryPath, r.candidatePath), r.label) // last write wins
  return map
}

/** Atomic write (temp + rename) — a Ctrl+C mid-write can't corrupt labels. */
export function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, path)
}

// ---------- metric computation (pure, unit-tested in eval/test/) ----------

export interface TopNEval {
  n: number
  /** of the top-N, how many carry a human label at all (coverage) */
  labeledTotal: number
  /** of the labeled ones, how many are "mix" — precision's numerator */
  labeledMix: number
  /** Camelot-compatible pairs (same number or wheel-neighbor same ring) */
  harmonicCount: number
  /** within 8% tempo at 1x/2x/0.5x — parts.bpm > 0 means "in range" */
  bpmInRangeCount: number
}

export function evaluateTopN(
  query: { path: string; camelot: string | null },
  ranked: Array<RankedCandidate<EvalTrack>>,
  labels: Map<string, LabelValue>,
): TopNEval {
  const out: TopNEval = { n: ranked.length, labeledTotal: 0, labeledMix: 0, harmonicCount: 0, bpmInRangeCount: 0 }
  for (const m of ranked) {
    const label = labels.get(pairKey(query.path, m.track.path))
    if (label === 'mix' || label === 'no') {
      out.labeledTotal++
      if (label === 'mix') out.labeledMix++
    }
    if (camelotCompatible(query.camelot, m.track.camelot)) out.harmonicCount++
    if (m.parts.bpm > 0) out.bpmInRangeCount++
  }
  return out
}

export function pct(num: number, den: number): string {
  return den === 0 ? '—' : `${Math.round((num / den) * 100)}%`
}
