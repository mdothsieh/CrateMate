# CrateMate

**A DJ's crate-digging companion.** Drop an MP3 → get the 5 most *mixable* tracks from your own library, with the reasons shown → export a Serato `.crate` you can open and play. Fully local: your audio, your play history, and the learned index never leave your machine.

> Built macOS-first with Electron + React + TypeScript. Audio analysis runs on your CPU (ffmpeg → Essentia.js → ONNX); the library lives in SQLite. No cloud, no accounts, no uploads.

## Why this exists

DJs spend enormous time digging for tracks that mix well — harmonic key, BPM, energy, *and* style. The obvious shortcut (Spotify's audio-features API) was removed for new apps in 2024, and Serato/rekordbox have no official APIs. So CrateMate takes the honest path: analyze the actual audio you already own, and read the DJ library files directly off disk.

## The interesting parts

- **Reverse-engineered Serato's binary formats.** `database V2`, `.crate` subcrates, and play-history sessions all share an undocumented TLV layout (4-char tag · big-endian length · payload, strings in UTF-16BE). CrateMate reads them — and writes byte-compatible `.crate` files that import straight into Serato. Reading is strictly read-only; the exporter refuses, in code, to ever write inside a live `_Serato_` folder.
- **Real audio ML, locally.** Each track is decoded with ffmpeg, mel-spectrogrammed with Essentia.js (WASM), and embedded with Discogs-EffNet via onnxruntime-node into a 1280-d style vector — across a worker-process pool with incremental re-indexing, ~1,700 tracks in minutes.
- **Similarity that respects how DJs actually mix.** Ranking blends style-embedding cosine, BPM proximity (half/double-time counts as the same groove), Camelot key compatibility, and energy. Every signal is a *soft* weight — open-format/KPOP sets break textbook harmonic-mixing rules on purpose, so nothing is hard-filtered, only down-ranked.
- **Quality is measured, not hoped.** The v1 gate is an eval harness: hand-labeled "mixes well / doesn't" pairs from real sets → precision@5 + harmonic/BPM rates, re-run after every engine change. (In progress — the last item of the v1 slice.)
- **Serato's analysis is treated as ground truth.** Where Serato has already computed BPM/key, CrateMate imports those values so it never visibly disagrees with the DJ's own screen; Essentia (with the `edmm` key profile, validated against Serato at 92% mix-compatible agreement) fills the gaps.

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│ MAIN (Node — trusted)                                       │
│  SQLite index · analysis worker pool (ffmpeg→Essentia→ONNX) │
│  Serato readers (READ-ONLY) · .crate/.m3u8 export (atomic)  │
└────────────▲────────────────────────────────────────────────┘
             │ typed IPC — every channel + type in src/shared/ipc.ts
┌────────────▼────────────────────────────────────────────────┐
│ RENDERER (Chromium, sandboxed — untrusted)                  │
│  React UI: index · drop zone · ranked matches · export      │
└─────────────────────────────────────────────────────────────┘
```

The renderer is sandboxed with no Node access; `app/src/shared/ipc.ts` is the app's entire attack surface, reviewable in one sitting. See [`app/ARCHITECTURE.md`](app/ARCHITECTURE.md) for the living architecture doc and [`PLAN.md`](PLAN.md) for the full decision log and roadmap.

## Run it

```bash
cd app
npm install                      # also rebuilds better-sqlite3 for Electron's ABI
node scripts/fetch-models.mjs    # one-time: downloads the Discogs-EffNet ONNX model (~17 MB)
npm run dev
```

Click **Index folder** and point it at a folder of MP3s (v1 is deliberately MP3-only). When indexing finishes, drop any track onto the window.

## Status

The ⭐ v1 vertical slice is nearly complete: indexing, find-similar with reasons, and Serato `.crate` + `.m3u8` export are built and verified on a real 1,664-track library. The eval harness is next. The longer-term vision (always-on-top Serato companion widget, theme-based set building, a personal style model learned from play history) is roadmapped in [`PLAN.md`](PLAN.md) — deliberately untouched until the core recommendation is proven good.

`spike-phase0-2026-06-10/` contains the Phase 0 de-risk spike: format reverse-engineering scripts, the embedding genre-sanity experiments, and [`SPIKE-RESULTS.md`](spike-phase0-2026-06-10/SPIKE-RESULTS.md) with the measured go/no-go numbers.

---

*Personal project by [Martin Hsieh](https://github.com/mdothsieh). Not affiliated with or endorsed by Serato.*
