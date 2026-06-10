# CrateMate — Architecture (living document)

> Updated whenever the structure changes. If code and this doc disagree, the doc is wrong — fix the doc.
> Last updated: 2026-06-10 (Phase 1: indexing + find-similar + crate export built)

## The 30-second picture

CrateMate is an **Electron** app, which means it's really **two programs talking through a wall**:

```
┌────────────────────────────────────────────────────────────────────┐
│  MAIN PROCESS (Node.js — trusted, has file/system access)          │
│                                                                    │
│   window management        src/main/index.ts                      │
│   IPC handlers             (one per channel in src/shared/ipc.ts) │
│   [Phase 1] SQLite index   the library's features database        │
│   [Phase 1] analysis pool  ffmpeg → Essentia/ONNX workers         │
│   [Phase 1] Serato readers .crate / database V2 / history (READ-ONLY)
│   [Phase 1] crate export   write .crate/.m3u8 to a SAFE location  │
└──────────────────────────▲─────────────────────────────────────────┘
                           │  typed IPC bridge (the wall's one door)
                           │  src/preload/index.ts  → window.cratemate
┌──────────────────────────▼─────────────────────────────────────────┐
│  RENDERER (Chromium, sandboxed — untrusted, NO file/Node access)   │
│                                                                    │
│   React UI                 src/renderer/src/app/                   │
│   Tailwind v4 styling      (imported once in index.css)            │
└────────────────────────────────────────────────────────────────────┘
```

**Why the wall?** If the UI is ever compromised (a malicious string in an MP3
tag rendering as HTML, say), the attacker lands in a sandbox that can't read
files. Every privileged operation must be a named, typed channel in
`src/shared/ipc.ts` — that file is the app's entire attack surface, reviewable
in one sitting.

## Folder map

```
app/
├── electron.vite.config.ts   build config (main/preload/renderer built separately)
├── tsconfig.json              one TS config for all three parts
├── src/
│   ├── shared/ipc.ts          ★ THE contract: every channel + its types
│   ├── shared/camelot.ts      key-notation funnel: everything → Camelot
│   ├── main/index.ts          backend entry: window, security policy, handlers
│   ├── main/library/          db.ts (SQLite) · indexer.ts (worker pool) · similar.ts (ranking)
│   ├── main/analysis/         worker.ts: ffmpeg → essentia.js mel → ONNX embedding
│   ├── main/serato/           format.ts + database.ts (READ) · crate-export.ts (WRITE — never into _Serato_)
│   ├── preload/index.ts       dumb bridge: one line per channel, no logic
│   └── renderer/
│       ├── index.html         CSP lives here (self-only, no remote origins)
│       └── src/app/           React app (main.tsx entry → App.tsx)
└── ARCHITECTURE.md            you are here
```

## Rules of the house (enforced by review, learned from PLAN.md)

1. **Serato files are read-only.** Nothing in this codebase ever writes inside
   `~/Music/_Serato_/`. Crate export writes to a user-chosen folder; importing
   into Serato is the user's manual action (v1).
2. **The preload stays dumb.** No logic in the bridge — logic belongs in main
   (trusted) or renderer (untrusted), never in between.
3. **No new IPC without types.** Channel name + request/response types go in
   `shared/ipc.ts` first; the compiler then forces both sides to agree.
4. **Local-first.** No network calls exist in v1 at all. When streaming
   discovery arrives (Phase 4), it lives in an isolated, disable-able module.
5. **Audio decoding is treated as parsing hostile input.** Analysis runs in
   child processes (ffmpeg already is one) so a malformed MP3 can crash a
   worker, not the app.

## Decisions inherited from Phase 0 (see spike folder for evidence)

- **BPM/key**: imported from Serato's `database V2` when available (1,341 of
  1,344 MP3s) so CrateMate never disagrees with the user's Serato screen.
  Essentia.js computes them only for files Serato hasn't analyzed — with the
  **`edmm`** key profile (92% mix-compatible agreement vs default's 62%).
- **Style embeddings**: Discogs-EffNet via **onnxruntime-node** (not TF.js —
  broken on Apple Silicon). Mel frontend: essentia.js `TensorflowInputMusiCNN`,
  16 kHz, patches of 128 frames × 96 bands → 1280-d embedding, mean-pooled
  over the middle 90 s of the track.
- **Engine scope**: MP3-only, pointed at `~/Documents/dj/`.

## Crate export (the write side of the Serato format)

`main/serato/crate-export.ts` mirrors `format.ts`: same TLV chunks, built
instead of parsed. A written crate is byte-compatible with a real one
(`vrsn "1.0/Serato ScratchLive Crate"` + `osrt`/`ovct` column records +
one `otrk`→`ptrk` per track, paths volume-root-relative in UTF-16BE).
Round-trip verified: our writer's output parses identically through our own
reader, including CJK filenames. Safety properties, enforced in code:

- refuses any destination inside a `_Serato_` folder (writer **and** handler)
- atomic writes (temp file + rename) — a crash can't leave a torn crate
- only paths that exist in the library DB are exported; the renderer can't
  inject arbitrary strings into a playlist file
- a `.m3u8` sibling (UTF-8, `#EXTINF` metadata from the DB) is written next
  to every `.crate` for non-Serato players

## How to run

```bash
npm install        # also rebuilds better-sqlite3 for Electron's ABI
npm run dev        # dev mode with hot reload
npm run typecheck  # strict TS across main/preload/renderer
```
