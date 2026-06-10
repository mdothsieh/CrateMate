# Phase 0 Spike Results — 2026-06-10

**Verdict: ✅ GO** (recommendation — see bottom). Every de-risk item passed on real data from this Mac.
All scripts in this folder are throwaway proofs; the real app reimplements them cleanly in Phase 1.

---

## 1. Serato `.crate` parsing — ✅ PASS

- Format: simple unencrypted TLV (tag/length/value) chunks; `otrk`→`ptrk` holds track paths relative to volume root.
- Verified on `KPOP.crate` (2 tracks) and `CHN - chill.crate` (10 tracks): every decoded path exists on disk, including Korean/Chinese filenames (UTF-16BE decodes cleanly).
- `serato-format.js` parses crates, the database, AND history with one ~100-line module.
- **Consequence:** widget (read current crate) and v1 export (write a crate) are both low-risk.

## 2. Serato `database V2` — ✅ PASS (better than hoped)

- 1,697 track records; **1,344 MP3s — 100% have Serato BPM, 99.8% (1,341) have key**. 1,241 live under `~/Documents/dj`.
- Key spellings are mixed notation (`Am`, `G#m`, `Abm`, plus some Camelot `11A`) → our `toCamelot()` normalizer handles all of them, including enharmonics.
- **Consequence:** a free, library-scale ground-truth corpus AND a ready-made import source.

## 3. Serato play history — ✅ PASS

- `History/Sessions/*.session`: `oent`→`adat` blobs with numeric field IDs. Identified: file path (2), title (6), artist (7), album (8), genre (9), source URL (17), start/end epoch (28/29), deck (31), play seconds (45), session id (48), played flag (50), key (51), device (63).
- Largest session: **6,192 entries** with full timestamps and per-track play duration.
- Bonus insight: `playTime` separates real plays (~600s) from browse/cue noise (0–3s) — the Phase 5 style model must filter on it.
- **Consequence:** personalization (Phase 5) has abundant fuel.

## 4. Essentia.js BPM/key vs Serato — ✅ PASS with a clear strategy

25-track random sample from the real library (`analyze-mp3.js --sample 25`, details in `essentia-vs-serato.json`):

| Metric | Result |
|---|---|
| BPM agreement (±3%, counting half/double-time as same groove) | **22/25 (88%)** — one "miss" was a sound effect Serato itself tagged BPM 0 |
| Key, Essentia default profile (`bgate`), strict Camelot match | 9/24 (38%) — weak |
| Key, **`edmm` profile** (electronic/urban-tuned), strict | 12/24 (50%) |
| Key, **`edmm`**, *mix-compatible* (same Camelot number or ±1 ring-adjacent) | **22/24 (92%)** |

- Most "misses" are relative major/minor labels (e.g. `8B` C major vs `8A` A minor) — harmonically identical for mixing.
- Timing: ~0.2s decode + ~4.4s analysis per track (full-length, serial).

## 5. Style embeddings on the user's genres — ✅ PASS

- Stack: `onnxruntime-node` + Essentia's **Discogs-EffNet** (`discogs-effnet-bsdynamic-1.onnx`, 17 MB) + essentia.js `TensorflowInputMusiCNN` mel frontend. No TensorFlow.js needed (avoids its Apple Silicon problems). Decision made with user.
- Test: 12 tracks across Chinese-chill / kpop / whitegirl (open-format), middle 90s each:
  - **11/11 tracks' nearest neighbor was same-genre.**
  - Within-genre mean cosine 0.617 vs cross-genre 0.465 → separation 0.152 (clear).
  - Same-artist detection emerged for free (two Avicii tracks: 0.868).
- ~2.1s per track (90s window, 16 kHz). C-pop ballads cluster correctly — the "Western-trained model" worry did not materialize at spike scale.

## 6. Deferred items (with user agreement)

- **Spotify API check** → Phase 4 (v1 has zero Spotify dependency; needs user's dev-app registration).
- **rekordbox `collection.xml`** → user is Serato-only; revisit if/when rekordbox support matters (Phase 8).

---

## Architecture decision unlocked by the spike

**v1 imports Serato's BPM/key for the 1,341 already-analyzed tracks** (perfect consistency with what the user sees in Serato — the credibility rule) **and runs Essentia only for embeddings + energy, plus full analysis (with the `edmm` key profile) for files Serato hasn't seen.**

First-run projection under that split: ~2–3s/track for embedding+energy ≈ 45–67 min serial for 1,344 tracks → **~10–15 min with 4–8 parallel workers**. With incremental indexing + progress UI this is an acceptable first impression; new tracks index in seconds.

## Go/No-Go

**GO to Phase 1** (scaffold + ⭐ v1 vertical slice). No blocker found; every risk the spike targeted resolved in our favor. The single biggest remaining unknown is exactly what v1's eval harness exists to measure: whether top-5 suggestions *feel* right to the user.
