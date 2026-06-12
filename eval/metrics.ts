/**
 * eval/metrics.ts — score the engine against the labeled set.
 *
 *   node eval/metrics.ts
 *
 * For each query in pairs.json the top-5 is recomputed LIVE from the
 * database with the app's current WEIGHTS (not read back from pairs.json) —
 * so after tuning weights you re-run this and the numbers reflect the new
 * ranking. Three metrics, per PLAN.md:
 *
 *   precision@5        of the top-5, what fraction did the user label "mix
 *                      well"? Only labeled pairs count (coverage reported);
 *                      computed micro (all labeled top-5 pairs pooled).
 *   harmonic rate      fraction of top-5 that are Camelot-compatible (no
 *                      labels needed — pure key theory).
 *   BPM-in-range rate  fraction of top-5 within 8% tempo at 1x/2x/0.5x.
 *
 * Writes eval/RESULTS.md (committed — aggregate numbers only, no track
 * names, since the repo is public).
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEIGHTS, rankCandidates } from '../app/src/shared/scoring.ts'
import { EVAL_DIR, loadTracks, readPairs, readLabels, evaluateTopN, pct, displayName, type TopNEval } from './lib.ts'

const tracks = loadTracks()
const byPath = new Map(tracks.map((t) => [t.path, t]))
const pairs = readPairs()
const labels = readLabels()

const perQuery: Array<{ name: string; ev: TopNEval }> = []

for (const q of pairs) {
  const query = byPath.get(q.queryPath)
  if (!query) {
    console.warn(`query no longer in index, skipping: ${q.name}`)
    continue
  }
  const ranked = rankCandidates(query, tracks.filter((t) => t.id !== query.id), WEIGHTS, 5)
  perQuery.push({ name: displayName(query), ev: evaluateTopN(query, ranked, labels) })
}

// --- aggregate (micro: pool every top-5 slot across queries) ----------------
const sum = perQuery.reduce(
  (a, { ev }) => ({
    n: a.n + ev.n,
    labeledTotal: a.labeledTotal + ev.labeledTotal,
    labeledMix: a.labeledMix + ev.labeledMix,
    harmonicCount: a.harmonicCount + ev.harmonicCount,
    bpmInRangeCount: a.bpmInRangeCount + ev.bpmInRangeCount,
  }),
  { n: 0, labeledTotal: 0, labeledMix: 0, harmonicCount: 0, bpmInRangeCount: 0 },
)

// RESULTS.md is committed to a public repo — per-query rows are anonymized
// (Q1, Q2, …); the name↔number mapping is printed to stdout only.
const rows = perQuery.map(({ ev }, i) =>
  `| Q${i + 1} | ${pct(ev.labeledMix, ev.labeledTotal)} | ${ev.labeledTotal}/${ev.n} | ${pct(ev.harmonicCount, ev.n)} | ${pct(ev.bpmInRangeCount, ev.n)} |`,
)

const report = `# Eval Results

Generated: ${new Date().toISOString().slice(0, 10)} · queries: ${perQuery.length} · labels on file: ${labels.size}
Weights: style ${WEIGHTS.style} / bpm ${WEIGHTS.bpm} / key ${WEIGHTS.key} / energy ${WEIGHTS.energy}

| Metric | Value |
|---|---|
| **precision@5** (labeled top-5 pairs that "mix well") | **${pct(sum.labeledMix, sum.labeledTotal)}** (${sum.labeledMix}/${sum.labeledTotal}) |
| label coverage of live top-5 | ${pct(sum.labeledTotal, sum.n)} (${sum.labeledTotal}/${sum.n}) |
| harmonic-compatibility rate | ${pct(sum.harmonicCount, sum.n)} |
| BPM-in-range rate (±8%, incl. half/double) | ${pct(sum.bpmInRangeCount, sum.n)} |

Per query (anonymized — the name↔Q-number mapping prints to the terminal only):

| Query | p@5 | labeled | harmonic | BPM in range |
|---|---|---|---|---|
${rows.join('\n')}

**Caveat (PLAN.md):** ~${labels.size} labeled pairs is a *trend indicator*, not truth.
Low label coverage means the live ranking surfaced pairs that were never labeled —
re-run \`node eval/sample.ts\` + \`label.ts\` after big weight changes.
`

const outPath = join(EVAL_DIR, 'RESULTS.md')
writeFileSync(outPath, report)
console.log(report)
console.log('query key (NOT in RESULTS.md):')
perQuery.forEach(({ name }, i) => console.log(`  Q${i + 1}  ${name}`))
console.log(`\nwrote ${outPath}`)
