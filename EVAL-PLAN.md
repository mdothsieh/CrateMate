# Eval Harness Plan — CrateMate v1

**Goal:** Measure recommendation quality on the user's real library (KPOP / C-pop / open-format), so v1 quality is *measured, not hoped*. Output: precision@5 + harmonic-compatibility rate + BPM-in-range rate, plus a short writeup kept in the repo.

**Scope guard (from PLAN.md):** 30–50 labeled pairs is a *trend indicator*, not truth. No over-tuning to small deltas. Labels must reflect how the user actually transitions (quick cuts, doubles, vocals), not textbook harmonic mixing.

## Design

Standalone Node scripts in `eval/` at repo root — no app changes except extracting the scorer. Scripts read `cratemate.sqlite` **read-only** via Node 26's built-in `node:sqlite` (avoids the better-sqlite3 Electron-ABI mismatch — the app's copy is rebuilt for Electron and won't load under plain `node`).

- [x] **1. Extract pure scorer** — moved to `app/src/shared/scoring.ts` (`scorePair` + `rankCandidates`, the full ranking pipeline incl. same-song dedup); `similar.ts` is now the Electron wrapper. *Verified: typecheck + production build pass; 11 scoring unit tests pin numeric behavior (parity guard).* ✅ 2026-06-12
- [x] **2. `eval/sample.ts`** — seeded-random 10 queries (or hand-picked via `eval/queries.txt`), top-5 + 2 random negatives each. *Verified: ran on live DB — 1,664 tracks, 70 pairs written, deterministic with `--seed`.* ✅ 2026-06-12
- [x] **3. `eval/label.ts`** — interactive labeling, ffmpeg-cut 15s preview @60s (afplay fallback), resumable atomic writes. *Verified: dry run through a pseudo-TTY — label recorded, resume skipped it.* ✅ 2026-06-12
- [x] **4. `eval/metrics.ts`** — precision@5 + coverage + harmonic + BPM-in-range, live re-rank, anonymized `eval/RESULTS.md`. *Verified: fixture unit tests + live run (harmonic 100%, BPM-in-range 100% pre-labels).* ✅ 2026-06-12
- [ ] **5. Weight tuning (after labels exist)** — `eval/tune.ts` built + guard verified (refuses <20 labels); grid search runs once the user labels. **Blocked on: user runs `node eval/label.ts`.**
- [x] **6. Writeup** — `eval/README.md` (method, metrics, limits) + `app/ARCHITECTURE.md` updated. ✅ 2026-06-12

## What the user does

Run `node eval/label.mjs` and label ~50 pairs by ear/memory (likely 15–30 min). Everything else is automated.

## Security Concerns

- **DB access is read-only** — scripts open `cratemate.sqlite` with `node:sqlite` in readonly mode; the eval never writes to the library DB or anything under `~/Music/_Serato_/`.
- **Public-repo exposure**: `eval/pairs.json` / `labels.json` contain artist + title + file paths from the personal library. Repo is public. Default: **gitignore the raw pairs/labels, commit only `eval/RESULTS.md` + scripts** — decision flagged to user.
- No network access anywhere in the harness; `afplay` only plays local files already in the DB.
- Preview playback shells out to `afplay` — paths come only from the DB (already-validated local files), passed as argv array (no shell interpolation).
