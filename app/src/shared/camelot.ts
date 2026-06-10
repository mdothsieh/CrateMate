/**
 * camelot.ts — key notation normalizer (logic proven in the Phase 0 spike).
 *
 * DJs mix harmonically using the Camelot wheel: 12 positions × 2 rings
 * (A = minor, B = major). Compatible keys = same number (relative maj/min)
 * or ±1 step on the same ring.
 *
 * The problem this solves: Serato's database mixes notations — "Am", "G#m",
 * "Abm" (enharmonic spellings!) and sometimes already-Camelot "11A", depending
 * on which tool tagged the file. Everything funnels through toCamelot() so the
 * rest of the app only ever sees one notation.
 */

const NOTE_TO_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
}

// pitch-class → Camelot code (derived from the circle of fifths)
const CAMELOT_MINOR: Record<number, string> = { 9: '8A', 4: '9A', 11: '10A', 6: '11A', 1: '12A', 8: '1A', 3: '2A', 10: '3A', 5: '4A', 0: '5A', 7: '6A', 2: '7A' }
const CAMELOT_MAJOR: Record<number, string> = { 0: '8B', 7: '9B', 2: '10B', 9: '11B', 4: '12B', 11: '1B', 6: '2B', 1: '3B', 8: '4B', 3: '5B', 10: '6B', 5: '7B' }

/** "Abm" | "G#m" | "11A" | "A minor" → "1A" (or null if unparseable). */
export function toCamelot(keyStr: string | null | undefined): string | null {
  if (!keyStr) return null
  const s = String(keyStr).trim()
  if (/^\d{1,2}[AB]$/i.test(s)) return s.toUpperCase()
  const m = s.match(/^([A-G][#b]?)\s*(m|min|minor)?$/i)
  if (!m) return null
  const pc = NOTE_TO_PC[m[1][0].toUpperCase() + (m[1][1] ?? '')]
  if (pc === undefined) return null
  return m[2] ? CAMELOT_MINOR[pc] : CAMELOT_MAJOR[pc]
}

/**
 * Harmonic compatibility by Camelot rules — used by the similarity engine's
 * key score. NOTE (PLAN.md genre-culture caveat): this is a SOFT signal in
 * CrateMate, never a hard filter — open-format sets break these rules on
 * purpose, so the weight is tunable down to zero.
 */
export function camelotCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const [na, ra] = [parseInt(a, 10), a.slice(-1)]
  const [nb, rb] = [parseInt(b, 10), b.slice(-1)]
  if (na === nb) return true // same number, either ring (incl. relative maj/min)
  const dist = Math.min(Math.abs(na - nb), 12 - Math.abs(na - nb))
  return dist === 1 && ra === rb // wheel neighbor on the same ring
}
