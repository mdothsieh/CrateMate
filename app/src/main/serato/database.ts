/**
 * serato/database.ts — reads Serato's `database V2` to import BPM/key.
 *
 * THE WHY (Phase 0 finding + Decision Log): Serato already analyzed all the
 * user's MP3s. Importing its BPM/key (a) guarantees CrateMate's numbers match
 * what the DJ sees on Serato's screen — the credibility rule — and (b) cuts
 * first-run indexing from ~104 min to ~10–15 min, since Essentia then only
 * computes what Serato doesn't have (embeddings + energy).
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { parseSeratoFile } from './format'
import { toCamelot } from '../../shared/camelot'

export interface SeratoTrackInfo {
  /** absolute path on the boot volume */
  filePath: string
  bpm: number | null
  key: string | null
  camelot: string | null
  title: string | null
  artist: string | null
}

function seratoDatabasePath(): string {
  return path.join(os.homedir(), 'Music', '_Serato_', 'database V2')
}

/**
 * Load Serato's analysis into a Map keyed by absolute file path.
 * Returns an empty map if Serato isn't installed — the app must work without it
 * (Essentia computes BPM/key as fallback during analysis).
 */
export function loadSeratoAnalysis(): Map<string, SeratoTrackInfo> {
  const map = new Map<string, SeratoTrackInfo>()
  const dbPath = seratoDatabasePath()
  if (!fs.existsSync(dbPath)) return map

  const { records } = parseSeratoFile(dbPath)
  for (const r of records) {
    if (r.type !== 'otrk' || typeof r.pfil !== 'string') continue
    // Serato stores paths relative to the volume root (no leading '/')
    const filePath = '/' + r.pfil
    const bpmRaw = typeof r.tbpm === 'string' ? parseFloat(r.tbpm) : NaN
    const key = typeof r.tkey === 'string' && r.tkey.trim() !== '' ? r.tkey.trim() : null
    map.set(filePath, {
      filePath,
      bpm: Number.isFinite(bpmRaw) && bpmRaw > 0 ? bpmRaw : null,
      key,
      camelot: toCamelot(key),
      title: typeof r.tsng === 'string' ? r.tsng : null,
      artist: typeof r.tart === 'string' ? r.tart : null,
    })
  }
  return map
}
