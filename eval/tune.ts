/**
 * eval/tune.ts — grid-search the four WEIGHTS against the labeled pairs.
 *
 *   node eval/tune.ts
 *
 * How it works: each pair's per-signal scores (style/bpm/key/energy) do not
 * depend on the weights — only the final blend does. So we compute the
 * signal scores ONCE per labeled pair, then trying a weight combo is just a
 * dot product. Per combo, per query: rank that query's LABELED candidates,
 * take the top min(5, #labeled), precision = fraction labeled "mix well".
 * Mean over queries = the combo's score.
 *
 * Ranking only the labeled pool (≈7 candidates/query) instead of the whole
 * library is what makes offline tuning honest: every candidate has a human
 * verdict, so a weight change can't "win" by surfacing unjudged tracks.
 *
 * ⚠️ PLAN.md caveat, enforced in the output: with this few labels the metric
 * is a TREND INDICATOR. Prefer the combo nearest the current weights among
 * the near-ties; never chase a 1-pair improvement.
 */
import { WEIGHTS, scorePair, type Weights } from '../app/src/shared/scoring.ts'
import { loadTracks, readPairs, readLabels, pairKey } from './lib.ts'

const tracks = loadTracks()
const byPath = new Map(tracks.map((t) => [t.path, t]))
const labels = readLabels()

// --- precompute per-pair signal scores (weight-independent) ------------------
interface LabeledCand { parts: { style: number; bpm: number; key: number; energy: number }; mix: boolean }
const queries: LabeledCand[][] = []

for (const q of readPairs()) {
  const query = byPath.get(q.queryPath)
  if (!query) continue
  const cands: LabeledCand[] = []
  for (const c of q.candidates) {
    const label = labels.get(pairKey(q.queryPath, c.path))
    if (label !== 'mix' && label !== 'no') continue // skips and unlabeled don't count
    const t = byPath.get(c.path)
    if (!t) continue
    cands.push({ parts: scorePair(query, t).parts, mix: label === 'mix' })
  }
  if (cands.length >= 2) queries.push(cands) // need something to rank
}

const totalLabeled = queries.reduce((s, q) => s + q.length, 0)
if (totalLabeled < 20) {
  console.error(`only ${totalLabeled} usable labels — label more pairs first (node eval/label.ts); tuning on fewer than ~20 is noise`)
  process.exit(1)
}
console.log(`${queries.length} queries, ${totalLabeled} labeled pairs\n`)

// --- evaluate one weight combo ----------------------------------------------
function precisionFor(w: Weights): number {
  let sum = 0
  for (const cands of queries) {
    const ranked = [...cands].sort(
      (a, b) =>
        (w.style * b.parts.style + w.bpm * b.parts.bpm + w.key * b.parts.key + w.energy * b.parts.energy) -
        (w.style * a.parts.style + w.bpm * a.parts.bpm + w.key * a.parts.key + w.energy * a.parts.energy),
    )
    const k = Math.min(5, ranked.length)
    sum += ranked.slice(0, k).filter((c) => c.mix).length / k
  }
  return sum / queries.length
}

// --- coarse grid over the weight simplex (sum = 1) ---------------------------
const combos: Array<{ w: Weights; p: number }> = []
for (let style = 0.15; style <= 0.7; style += 0.05) {
  for (let bpm = 0; bpm <= 0.45; bpm += 0.05) {
    for (let key = 0; key <= 0.3; key += 0.05) {
      const energy = 1 - style - bpm - key
      if (energy < -1e-9 || energy > 0.25) continue
      const w: Weights = {
        style: +style.toFixed(2), bpm: +bpm.toFixed(2), key: +key.toFixed(2), energy: +energy.toFixed(2),
      }
      combos.push({ w, p: precisionFor(w) })
    }
  }
}
combos.sort((a, b) => b.p - a.p)

const baseline = precisionFor(WEIGHTS)
const fmt = ({ w, p }: { w: Weights; p: number }): string =>
  `style ${w.style.toFixed(2)}  bpm ${w.bpm.toFixed(2)}  key ${w.key.toFixed(2)}  energy ${w.energy.toFixed(2)}  →  p@5 ${(p * 100).toFixed(1)}%`

console.log(`current  ${fmt({ w: WEIGHTS, p: baseline })}\n`)
console.log(`top 10 of ${combos.length} combos:`)
for (const c of combos.slice(0, 10)) console.log(`  ${fmt(c)}`)
console.log(
  `\nReminder: ${totalLabeled} labels = trend indicator. Only change WEIGHTS (app/src/shared/scoring.ts)\n` +
  'if a clearly better region shows up, then re-run node eval/metrics.ts and re-check the app by feel.',
)
