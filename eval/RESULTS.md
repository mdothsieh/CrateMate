# Eval Results

Generated: 2026-06-12 · queries: 10 · labels on file: 0
Weights: style 0.45 / bpm 0.3 / key 0.15 / energy 0.1

| Metric | Value |
|---|---|
| **precision@5** (labeled top-5 pairs that "mix well") | **—** (0/0) |
| label coverage of live top-5 | 0% (0/50) |
| harmonic-compatibility rate | 100% |
| BPM-in-range rate (±8%, incl. half/double) | 100% |

Per query (anonymized — the name↔Q-number mapping prints to the terminal only):

| Query | p@5 | labeled | harmonic | BPM in range |
|---|---|---|---|---|
| Q1 | — | 0/5 | 100% | 100% |
| Q2 | — | 0/5 | 100% | 100% |
| Q3 | — | 0/5 | 100% | 100% |
| Q4 | — | 0/5 | 100% | 100% |
| Q5 | — | 0/5 | 100% | 100% |
| Q6 | — | 0/5 | 100% | 100% |
| Q7 | — | 0/5 | 100% | 100% |
| Q8 | — | 0/5 | 100% | 100% |
| Q9 | — | 0/5 | 100% | 100% |
| Q10 | — | 0/5 | 100% | 100% |

**Caveat (PLAN.md):** ~0 labeled pairs is a *trend indicator*, not truth.
Low label coverage means the live ranking surfaced pairs that were never labeled —
re-run `node eval/sample.ts` + `label.ts` after big weight changes.
