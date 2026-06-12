# Eval Harness

Measures whether CrateMate's "find similar" actually finds *mixable* tracks — on the
owner's real library and real transition style — instead of hoping it does.
**precision@5 is the headline number**: of the 5 suggestions the app shows, how many
did a human DJ judge as "yes, I'd mix that".

## Why it's built this way

- **Same code, two consumers.** The scoring math lives in
  [`app/src/shared/scoring.ts`](../app/src/shared/scoring.ts) and is imported by both
  the Electron app and these scripts, so the eval measures the engine that ships —
  not a reimplementation that can drift.
- **Plain Node, zero deps.** The app's `better-sqlite3` is compiled for Electron's
  ABI and won't load under `node`, so the harness reads the same SQLite file through
  Node's built-in `node:sqlite` — opened **read-only**. TypeScript runs directly via
  Node's native type stripping (Node ≥ 23; this repo uses 26).
- **Human labels, not theory.** Camelot/BPM rules come from house/techno culture; this
  library is KPOP / C-pop / open-format, where great transitions break those rules on
  purpose (cuts, doubles, vocal energy). So the ground truth is the owner labeling
  pairs by ear, and harmonic/BPM rates are reported *alongside* precision rather than
  defining it.
- **Random negatives keep tuning honest.** Each query also gets 2 random non-top-5
  candidates labeled. Weight tuning re-ranks only labeled pairs, so a weight change
  can't "improve" the number by surfacing tracks nobody ever judged.

## Workflow

```bash
node eval/sample.ts    # build pairs.json: 10 queries × (top-5 + 2 random) = 70 pairs
node eval/label.ts     # interactive: preview audio, label y/n/s — resumable
node eval/metrics.ts   # precision@5 + harmonic + BPM rates → RESULTS.md
node eval/tune.ts      # grid-search the 4 weights against the labeled pairs
node --test eval/test/scoring.test.ts eval/test/metrics.test.ts
```

Queries default to a seeded random sample (reproducible); drop search terms in
`eval/queries.txt` (one per line) to hand-pick them instead.

## Reading the numbers

| Metric | Meaning |
|---|---|
| precision@5 | of the *labeled* live top-5 pairs, fraction labeled "mix well" |
| label coverage | how much of the live top-5 carries a label at all — if this drops (e.g. after weight changes), sample + label again before trusting p@5 |
| harmonic rate | fraction of top-5 that are Camelot-compatible (theory, no labels needed) |
| BPM-in-range | fraction within 8% tempo at 1x/2x/0.5x |

**Known limits:** ~50–70 labeled pairs makes precision@5 a trend indicator, not a
truth — don't chase single-pair deltas when tuning. One labeler (the owner) means the
metric encodes *his* mixing style; that's intentional for v1.

`pairs.json` / `labels.json` are gitignored (they contain artist/title/paths from a
personal library; this repo is public). Only the scripts and the aggregated
[`RESULTS.md`](RESULTS.md) are committed.
