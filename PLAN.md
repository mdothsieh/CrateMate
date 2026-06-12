# CrateMate — Plan

> **Name:** CrateMate
> A desktop tool for DJs that runs in **two modes sharing one engine**, with an **AI layer that learns how *you* DJ**:
> 1. **Full app** — drop an MP3 to find similar/mixable tracks, and describe a set's theme to get curated suggestions.
> 2. **Companion widget** — a floating, always-on-top panel beside Serato/rekordbox that scans your **current crate** and suggests the **next track** (from your own library or the internet), on demand.
> 3. **AI differentiation layer** — learns your personal style from your play history + feedback, generates DJ-/style-inspired sets, and coaches mixing technique. This is what sets it apart from existing tools.

---

## Context

DJs spend huge time crate-digging for tracks that mix well (harmonic key + BPM + energy + style) and fit a set's vibe — and when *building a set*, the hardest question is "what comes next?" Existing tools are weak here. The obvious shortcut, Spotify's recommendation/audio-features API, was **removed for new apps in Nov 2024**; rekordbox, Serato, and Netease have **no official APIs**. So the honest path is: analyze the *actual audio* DJs already have, read their library files directly, and treat streaming as a discovery/links layer rather than an analysis engine.

**Feasibility reality (important):** Neither Serato nor rekordbox exposes a plugin SDK — you **cannot embed a panel inside their UI**. The widget is therefore a **separate always-on-top companion window** that watches/reads the crate files on disk. **Serato is much more widget-friendly** (its `.crate` files update on disk and are readable on demand); **rekordbox** keeps everything in an encrypted DB with no live export, so its widget support is deferred and will rely on manual re-scan of an exported XML.

**Decisions locked with the user:**
- Platform: **macOS-first, code stays cross-platform** (Windows = mostly a packaging step in the product phase). Scope: **personal now, product later**.
- Modes: **Full app + companion widget** (shared engine).
- Widget first target: **Serato**. (rekordbox widget = later, manual re-scan.)
- Next-track logic: **both, switchable** — "smooth mix from last track" *and* "build the set's energy arc".
- Refresh: **on-demand "Suggest next" button** (not live auto-watch for MVP).
- Similarity: **hybrid, audio-first**. Sources: **own library + streaming discovery**.
- Output: export playlist file + in-app list/links + copyright-safe "download-links folder"; direct write into Serato/rekordbox deferred.
- Theme input: **free-text + filters/sliders**. Owner is design-focused; stack calls made for them.
- AI differentiators (all wanted, sequenced as their own layer): **learn my style** (history **+** feedback), **DJ-inspired sets** (style archetypes **+** named-DJ "inspired by"), **technique coaching** (transition hints → deep structural analysis).

---

## Decision Log — explicitly verified with user 2026-06-10

| Decision | Verdict | Implication |
|---|---|---|
| **v1 hard gate** | ✅ Confirmed | No Phase 2+ work until the v1 slice's top-5 feel right AND precision@5 is measured. |
| **Stack** (Electron/React/TS/Tailwind, Essentia.js, SQLite, Claude API) | ✅ Confirmed, one concern | Concern = **user's ability to maintain the codebase** (design-focused dev). Mitigations adopted: living `ARCHITECTURE.md` with diagrams, teach-as-we-go explanations with each significant chunk, heavy inline code comments, bias to boring readable code. |
| **Serato-first**, rekordbox via exported XML only | ✅ Confirmed | User's primary software is Serato (real library at `~/Music/_Serato_/`). |
| **Streaming = discovery + links only** | ✅ Confirmed, one change | **Netease elevated**: still legal/links-only and isolated, but it's a *priority* discovery source, not best-effort (user is an active Netease user). |
| **Eval labeling** | ✅ User DJs and will hand-label the ~30–50 pairs himself | No outside ears needed for v1. |
| **Library reality** | **`~/Documents/dj/`** — all DJ music past/present/future, 78 GB | Organized in genre/gig subfolders (kpop, Chinese-chill, whitegirl, edits, TAO, ALL…). **User decision 2026-06-10: the engine handles MP3 files ONLY (~1,670 tracks)** — ignore `.ncm` entirely (user will provide MP3s going forward; never build DRM decryption) and don't bother with WAV/FLAC/AIF in v1. One decode path = simpler engine. ~1,700 tracks still makes **first-run indexing cost real** → progress UI + incremental indexing are mandatory; Phase 0 times per-track analysis to project the full first run. |
| **Genre profile** | **KPOP + C-pop + open-format party (hip-hop/pop/EDM)** | Critical: most audio-ML models are trained on Western electronic/pop. Phase 0 must validate Essentia embeddings on *these* genres; the eval set must be built from them. Vocal-heavy tracks with mid-song tempo/section changes are the hard case. |
| **Timeline** | **Demoable by early September 2026** | ~3 months. v1 + ideally the widget by then; everything else is upside. |
| **Claude API** | **Prefer to avoid API costs** | v1 + widget are unaffected (fully local). AI/theme features (Phases 3, 5–7) must be designed **optional + mock-provider-first**; revisit cost/alternatives when Phase 3 arrives. |
| **Mixability definition** | ⚠️ Genre-culture mismatch risk identified | Harmonic/BPM theory is house/techno culture; user's open-format/KPOP style may invalidate it. Hard filters → soft-enable weights; eval labels = the user's *real* transition style. See caveat under "Find-similar". |
| **Serato `database V2` = ground truth + consistency target** | New Phase 0 input | Serato already analyzed the whole library (BPM/key). Use it to validate Essentia at scale, and likely import its values so CrateMate never visibly disagrees with Serato's screen. |
| **Feature freeze ~mid-Aug 2026** | New milestone (earlier than "early Sept") | By mid-August: v1 done, **demo video recorded the day v1 works**, README/writeup polished. Widget = stretch goal, not part of the deadline. Owner keeps a **decision journal in his own words** and personally runs eval labeling + weight tuning — first-hand understanding of every decision is the point. |

---

## ⭐ v1 — The Vertical Slice (BUILD THIS FIRST)

> Everything in the Roadmap below is the **full vision**. Do **not** build it top-to-bottom. **Ship this one slice first.** It's self-contained, demoable in 60 seconds, and proves the only thing that actually matters: *the core recommendation is good.* Scope is the enemy — depth on the hard part is the asset.

**The demo (≤60s):** Point the app at a folder of your MP3s → it analyzes them → drag in a track → get **5 "mixable" matches with the reason shown** (compatible key / close BPM / similar energy) → one click **exports a Serato `.crate`** you can open in Serato. A small **eval harness** reports precision@5, so quality is *measured, not hoped*.

**Why this slice:** it's the foundation the widget, themes, and AI layer all sit on; it works without Serato even running; and the hard parts live here — a reverse-engineered binary format and an audio-similarity engine that is *evaluated*, not eyeballed.

**Done when:** on your real library the top-5 are subjectively "yeah, I'd mix those" most of the time, **precision@5 is measured**, and the exported crate opens cleanly in Serato.

---

## App Modes

| Mode | What it is | Notes |
|---|---|---|
| **Full app** | Main window: library indexing, drag-MP3→similar, theme search, exports | The original concept; the "home base". |
| **Widget mode** | Compact **floating always-on-top** window beside the DJ software | Same engine/DB. Reads the current Serato crate on demand, shows "next track" picks. Menu-bar/tray variant is an easy future alternative. |

Both modes are the same Electron app with two windows over one shared SQLite library + Essentia.js engine.

---

## Platform Support

**Strategy: macOS-first, code stays cross-platform.** Develop and test on Mac now (where Serato can be tested live); keep the code OS-agnostic so Windows is mostly a packaging task later. Electron runs both from one codebase.

| Concern | Handling |
|---|---|
| **Library paths** | Resolve Serato `_Serato_` and rekordbox locations **per-OS at runtime** (Music folder, external-drive roots, AppData vs Application Support) — never hardcode. |
| **Secrets storage** | Electron `safeStorage` abstracts macOS Keychain ↔ Windows Credential Vault. |
| **Widget over full-screen (macOS gotcha)** | A floating window may not hover over a true full-screen Space on macOS. Mitigate via a high window level / "screen-saver" level, or design for Serato running windowed. Test early in Phase 2. |
| **Native modules** | `better-sqlite3`, `ffmpeg-static` need per-OS builds; `essentia.js` is WASM (portable). `electron-builder` handles per-OS packaging. |
| **Distribution signing** | Mac: Apple notarization (~$99/yr) to avoid Gatekeeper warnings. Windows: code-signing cert to avoid SmartScreen. **Only needed at the product stage** — personal/local runs unsigned. |

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Electron + TypeScript** | One language; supports multi-window + always-on-top + tray natively; best path for local audio decode + drag-drop. (Tauri = lighter alt, rejected for MVP.) |
| UI | **React + TypeScript + Tailwind** | Design-forward; full app and widget share components. |
| Audio analysis | **Essentia.js (WASM)** + `ffmpeg-static` | BPM, key/scale, energy, danceability + style **embeddings**, all in JS (no Python). |
| Local store | **SQLite** (`better-sqlite3`) | Library + per-track feature vectors; shared by both modes. |
| Theme intelligence | **Claude API** (`claude-sonnet-4-6` default) | Free-text vibe → target feature profile. **User prefers to avoid API costs → design optional + mock-provider-first; v1/widget don't need it.** |
| Streaming | Spotify (search/playlists), YouTube Data API, Netease (unofficial, best-effort) | Discovery + links only — not analysis. |

---

## Recommendation Engines

### A. Find-similar (full app)
Analyze a dropped MP3 → rank library by *hard filters* (BPM in mix range, harmonically compatible Camelot keys) + *soft score* (cosine similarity on style embedding + energy proximity).

> **⚠️ Genre-culture caveat (verified blind spot, 2026-06-10):** Camelot/BPM-range mixing theory comes from house/techno (long harmonic blends). The user plays **open-format/KPOP/C-pop**, where sets run on recognition, vocals, quick cuts, and doubles — a great pair can be 20 BPM apart. Therefore the "hard" filters must be implemented as **configurable weights that can soften to zero**, and the eval labels must reflect **how the user actually transitions**, not textbook harmonic mixing. Be prepared for the eval to show key matters less than this design assumes.

### B. Set-aware "next track" (widget) — the new core feature
On pressing **Suggest next**, read the current Serato crate, then rank candidates by one of two switchable modes:
- **Smooth mix:** transition cleanly from the **last track** — compatible Camelot key, close BPM, similar energy/style.
- **Energy arc:** read the **whole crate's** energy progression and suggest tracks that continue the intended arc (keep building, plateau, or cool down).
- Always: exclude tracks already in the crate; candidates come from owned library and/or streaming discovery.

### C. Themed-set suggestions (full app)
Free-text → Claude → **target profile** (BPM band, energy curve, mood/genre tags, key set) → rank library + streaming candidates. Sliders edit the *same* profile, so free-text and manual control are one mechanism.

---

## Evaluation — how we know it's actually good

> The most-overlooked, highest-value piece. Without this, "good recommendations" is a hope. With it, it's a number.

- **Labeled set:** hand-tag ~30–50 track pairs as *"mix well"* / *"don't"* — the user DJs and labels these himself. Build the set from his real genres (**KPOP / C-pop / open-format**), not generic electronic music.
- **Metrics:** **precision@5** (of 5 suggestions, how many are genuinely mixable) + harmonic-compatibility rate + BPM-in-range rate.
- **Loop:** re-run after any change to the engine or the hard-filter/soft-score weights → catch regressions, tune deliberately instead of by vibes.
- Keep the harness + a short writeup **in the repo** so quality stays measured, not hoped.

---

## AI & Differentiation Layer (the signature features)

These build on the engines above and are what make the product distinct. All processing stays local; only **derived features/metadata** (never raw audio) are ever sent to the Claude API.

### 1. Personal style model — "it knows how *I* DJ"
- **Inputs:** Serato/rekordbox **play history** (read-only) + in-app **thumbs up/down** on suggestions.
- **Model:** transition statistics (key→key moves, BPM-delta distribution, genre sequences, energy arc across a set, position-in-set tendencies) + an aggregate "taste embedding" from frequently-played tracks.
- **Use:** a **personalization re-ranker** that biases the find-similar / next-track / theme results toward *your* tendencies. Claude also writes a plain-language "your style" summary you can read and correct.

### 2. DJ-/style-inspired sets
- **Style archetypes:** Claude defines a target profile (BPM/genre/energy/key tendencies) for a vibe like "hypnotic peak-time techno" → rank your library + streaming. Zero legal risk.
- **Named-DJ "inspired by":** Claude characterizes a known artist's *style* into a profile, optionally seeded by public tracklist **patterns** (never copying playlists), clearly labeled **"inspired by — not affiliated or endorsed."**
- **Combine with #1:** "a peak-time set like X, but tuned to how *you* mix."

### 3. Technique coaching
- **v1 — transition hints:** from key relationship, BPM/energy delta, intro/outro & vocal presence → suggest techniques (echo/reverb tail out, EQ swap vs long blend, tone-play over a shared key, scratch a percussive intro, loop-roll a breakdown).
- **v2 — structural analysis:** approximate song structure (intro/build/breakdown/drop/outro) for **timestamped** advice ("blend in over the 16-bar intro at ~0:32").
- Phrased by Claude into clear, DJ-native language.

---

## Integration Reality

| Platform | MVP approach | Note |
|---|---|---|
| Local MP3s | Decode + Essentia.js analysis | Core engine, fully ours. |
| **Serato (widget)** | Read unencrypted `_Serato_/Subcrates/*.crate` on demand; export a `.crate` to import | Live-readable on disk → enables the widget. Low risk. |
| rekordbox | Read user-**exported** `collection.xml`; export `rekordbox.xml`; widget = manual re-scan, later | **Never touch encrypted `master.db`**. |
| Spotify | Search, read user playlists/saved, create playlists | Recommendations/audio-features API is **dead** for new apps — must not depend on it. |
| YouTube | Data API search/playlists; user-initiated links only | Copyright/ToS — links only. |
| Netease | Unofficial API, isolated — **priority discovery source** (user is an active Netease user) | Legally gray, may break — still links-only & sandboxed, but treated as important, not best-effort. |

### Track identity (a sneaky-hard problem to plan for)
Real libraries are full of **duplicates, remixes, edits, and messy tags**, and streaming results must be matched to what you own ("is this YouTube hit the *same* track? a different version?"). Plan for it: start simple in v1 (**normalized artist+title+duration matching** to dedupe), then add **acoustic fingerprinting (Chromaprint/AcoustID)** when local + streaming results merge (Phase 4+). Underestimating this is a classic way these tools feel broken.

---

## Output / Export Design (copyright-aware)

1. **In-app list** — always: previews + Spotify/YouTube/Netease links.
2. **Export playlist file** — `.m3u8` (universal), `rekordbox.xml`, Serato `.crate`.
3. **"Crate folder"** — owned tracks copied/symlinked into a folder; unowned tracks written to a `download-links.md` manifest so the DJ acquires them by their own means. Never auto-downloads.
4. **Direct write into Serato/rekordbox** — deferred to Phase 8; export→manual-import first.

---

## Security Concerns & Resolutions

### Secrets & credentials
- [ ] **Spotify OAuth** — use **PKCE flow** (no client secret in the shipped app). *Resolves: secret leakage from a distributable binary.*
- [ ] **Token storage** — OS keychain (`safeStorage`/`keytar`), never plaintext, never in SQLite. *Resolves: token theft from disk.*
- [ ] **Claude API key** — personal: keychain/`.env` (git-ignored). Product-later: **proxy via backend** so the key never ships to clients. *Resolves: key exfiltration.*
- [ ] **`.gitignore`** covers `.env`, tokens, local DB, credential caches before first commit. *Resolves: accidental secret commits.*

### Electron hardening (applies to BOTH windows)
- [ ] `contextIsolation: true`, `nodeIntegration: false`, renderer `sandbox: true` — for full app **and** widget window. *Resolves: XSS → native code execution.*
- [ ] Strict typed **IPC**; validate every payload; no generic "run arbitrary" bridge. *Resolves: renderer → main privilege abuse.*
- [ ] **CSP** set; block navigation/`window.open` to untrusted origins; disable `webview`/`remote`. *Resolves: malicious page loads.*

### Widget-specific
- [ ] Always-on-top widget **only reads crate files** — no global input capture, no screen capture, no keylogging. *Resolves: the widget being (or looking like) spyware.*
- [ ] Crate file access is **read-only**; the widget never writes into `_Serato_`. *Resolves: corrupting a live Serato library while DJing.*

### File handling
- [ ] **Library files read-only in MVP**; **never touch encrypted rekordbox `master.db`**. *Resolves: corrupting a DJ's live library.*
- [ ] Any export write → **temp file → atomic rename**, with a **backup** of the original first. *Resolves: partial-write corruption.*
- [ ] **Untrusted audio parsing** in a **sandboxed child process**; validate type/size; keep `ffmpeg-static` patched. *Resolves: malformed-file crashes / decoder exploits.*

### Third-party / legal-adjacent
- [ ] **Netease/YouTube modules isolated**, disable-able, **no auto-download** — links/manifest only. *Resolves: legal exposure (版权) + untrusted endpoints.*
- [ ] **Dependency hygiene**: lockfile committed, `npm audit` in CI, pinned versions, review new deps. *Resolves: supply-chain compromise.*

### AI, privacy & likeness
- [ ] **Play history + style model are personal behavioral data** — stored **local-only**, never uploaded; user can **view / export / delete** the learned model. *Resolves: silently profiling the user / surprise data collection.*
- [ ] **Send derived features/metadata to Claude, never raw audio**; minimize payloads. *Resolves: leaking copyrighted audio or excess personal data to a third party.*
- [ ] **Named-DJ feature labeled "inspired by — not affiliated/endorsed"**; derive *style patterns* only, never store/copy copyrighted tracklists. *Resolves: trademark/likeness/endorsement-implication exposure.*
- [ ] In the **product phase**, any cloud sync of the style model requires **explicit opt-in consent**. *Resolves: centralizing personal data without consent.*

### Product-later
- [ ] If multi-user: real auth, per-user token isolation, server-side secrets, row-level access control. *Resolves: cross-tenant leakage — revisit at Phase 8.*

---

## Roadmap (checklist)

> **The ⭐ v1 slice = Phase 0 + the starred items in Phase 1.** That's the first real deliverable. Phases 2–8 are the future vision — only continue if v1 feels great.

### Phase 0 — De-risk spike ✅ COMPLETE 2026-06-10 (see `spike-phase0-2026-06-10/SPIKE-RESULTS.md`)
- [x] Essentia.js extracts believable BPM/key/embedding from a real MP3 (Node + WASM; pipeline = ffmpeg-static → PCM → Essentia)
- [x] Embedding sanity check **on KPOP / C-pop / open-format tracks** — Discogs-EffNet via **onnxruntime-node** (chosen with user over TF.js): 11/11 nearest-neighbors same-genre, within/cross-genre cosine separation 0.152 → PASS
- [x] Parse Serato **`database V2`** → 1,344 MP3s, 100% with Serato BPM, 99.8% with key. Essentia vs Serato on 25-track sample: **BPM 88% agree** (half/double counted as same groove); key with **`edmm` profile 92% mix-compatible**
- [x] Go/no-go import decision: **YES — v1 imports Serato's BPM/key where available** (credibility rule honored), Essentia computes embeddings/energy + full analysis (`edmm` key profile) for unanalyzed files. Projected first run ~10–15 min with parallel workers
- [x] Read a real Serato `.crate` file (KPOP + CHN-chill crates; all paths decode and exist on disk, incl. CJK filenames)
- [x] Read a real Serato **play-history** session (6,192-entry session; fields incl. timestamps, playTime, deck, key — Phase 5 has fuel; filter browse-noise by playTime)
- [~] Read a rekordbox-exported `collection.xml` — **deferred** (user is Serato-only; revisit at Phase 8)
- [~] Confirm what the current Spotify API still returns — **deferred to Phase 4 with user agreement** (v1 has zero Spotify dependency)
- [x] Go/no-go decision recorded: **GO** (✅ confirmed by user 2026-06-10 → Phase 1 started)

### Phase 1 — Local engine + full app (core value) — contains the ⭐ v1 slice — IN PROGRESS (app at `CrateMate/app/`)
- [x] Scaffold Electron + React + TS + Tailwind; apply Electron security hardening *(2026-06-10: electron-vite, sandboxed renderer, typed IPC in `src/shared/ipc.ts`, CSP, nav blocked; ARCHITECTURE.md living doc)*
- [x] ⭐ Point at a folder → index MP3s → store features in SQLite (**first-run progress + incremental indexing**) *(2026-06-10: utilityProcess worker pool ×4, Serato BPM/key import, embeddings+energy via ONNX; verified on real `whitegirl` folder — 61 tracks, 59 Serato-tagged, all embedded. Full `~/Documents/dj` run not done yet)*
- [x] ⭐ Basic **track-identity dedup** (normalized artist+title) *(2026-06-10: in `similar.ts` — strips (SPOTISAVER)/[site] junk; duration check + Chromaprint still future)*
- [x] ⭐ Drag-and-drop an MP3 → ranked "similar/mixable" list **with the reason shown** *(2026-06-10: reason chips = vibe % / BPM w/ half-double / Camelot / energy; weights style .45 bpm .30 key .15 energy .10, ALL soft per genre caveat; on-the-fly analysis for new files. **Subjective quality verdict from user still pending**)*
- [x] ⭐ Export a Serato `.crate` (and `.m3u8`) *(2026-06-10: `serato/crate-export.ts` — write-side TLV mirroring the reader, byte-structure matches real crates, round-trip parsed incl. CJK paths; atomic writes, `_Serato_` destinations refused, DB-validated paths only. **User must verify: import an exported crate into Serato**)*
- [x] ⭐ **Eval harness**: ~30–50 labeled pairs → precision@5 + harmonic/BPM rates *(2026-06-12: `eval/` at repo root — sample/label/metrics/tune scripts on plain Node via `node:sqlite` read-only; scoring math extracted to `app/src/shared/scoring.ts` so app + eval share one implementation, pinned by 14 unit tests; pairs/labels gitignored, RESULTS.md anonymized. **User must label: `node eval/label.ts` — 70 pairs generated**)*
- [ ] ⭐ Verify on a real personal MP3 folder; tune weights against the eval *(full library indexed 2026-06-10: 1,664 tracks, 100% embedded+BPM+key — 1,223 Serato, 441 Essentia; weight tuning awaits the eval harness)*

### Phase 2 — Serato companion widget (the new core feature)
- [ ] Second always-on-top widget window sharing the engine/DB
- [ ] Read the current Serato crate on demand (`Suggest next` button)
- [ ] "Smooth mix" mode (continue from last track)
- [ ] "Energy arc" mode (continue the set's progression)
- [ ] Toggle between modes; exclude tracks already in the crate
- [ ] Verify while actually building a crate in Serato

### Phase 3 — Theme engine
- [ ] Free-text vibe → Claude → target profile; filters/sliders edit same profile
- [ ] Rank local library against profile; verify with 3 vibe prompts

### Phase 4 — Streaming discovery
- [ ] Spotify search + playlist read (PKCE auth, keychain tokens)
- [ ] YouTube Data API search; Netease module (isolated, best-effort)
- [ ] **Acoustic fingerprinting (Chromaprint/AcoustID)** to match streaming results to owned tracks
- [ ] "Download-links folder" generation (owned vs unowned tracks)

> **AI differentiation layer (Phases 5–7).** The signature features. They re-use the engines + candidate sources above, so they slot in after the foundation. *Note: the play-history parsing for Phase 5 is independent plumbing and can begin as early as the Phase 0 spike if you want the differentiator sooner.*

### Phase 5 — AI: Personal style model
- [ ] Parse Serato/rekordbox play history (read-only) into transition/energy/genre stats
- [ ] Thumbs up/down feedback capture on suggestions
- [ ] Personalization re-ranker biasing find-similar / next-track / theme results
- [ ] Claude-generated "your style" summary (viewable, correctable)
- [ ] Local-only storage with view/export/delete controls
- [ ] Verify: suggestions visibly shift toward your real historical tendencies

### Phase 6 — AI: DJ-/style-inspired sets
- [ ] Style-archetype profiles (e.g. "hypnotic peak-time techno") → ranked sets
- [ ] Named-DJ "inspired by" profiles, labeled "not affiliated/endorsed"
- [ ] Blend with personal style model ("like X, tuned to how you mix")
- [ ] Verify: 3 archetypes + 1 named profile produce coherent, fitting sets

### Phase 7 — AI: Technique coaching
- [ ] v1 transition hints (echo out, EQ swap, tone play, scratch, loop-roll) from features
- [ ] v2 structural analysis (intro/build/breakdown/drop/outro) → timestamped advice
- [ ] Claude phrasing into DJ-native language
- [ ] Verify: hints make sense on real track pairs you know

### Phase 8 — Product-later
- [ ] rekordbox widget (manual re-scan via exported XML)
- [ ] Direct Serato/rekordbox write (with backups)
- [ ] **Windows packaging + testing** (per-OS path resolution, native-module builds) and **code signing/notarization** (Mac + Windows)
- [ ] Accounts / onboarding / multi-setup; backend proxy for API keys + multi-user security
- [ ] Opt-in cloud sync of the personal style model (explicit consent)

---

## Verification (per phase, on real data)

- **Phase 0/1 (the ⭐ v1 gate):** Run on own MP3s; spot-check BPM/key vs known tracks; **measure precision@5 on the labeled set**; confirm exported `.crate` imports into Serato and `.m3u8` opens elsewhere. Don't move past v1 until the top-5 feel right.
- **Phase 2:** Build a real crate in Serato; press Suggest next; confirm "smooth mix" picks actually mix from the last track and "energy arc" picks continue the progression.
- **Phase 3:** Type vibe prompts; confirm results fit; tweak a slider and watch results shift coherently.
- **Phase 4:** Confirm Spotify search returns candidates; download-links folder + manifest generate correctly for owned vs unowned tracks.
- **Phase 5:** With history loaded, confirm suggestions measurably shift toward your real tendencies; the "your style" summary reads true.
- **Phase 6:** Generate 3 archetype sets + 1 named "inspired by" set; confirm they're coherent and on-style.
- **Phase 7:** On track pairs you know well, confirm the technique hints are sensible and correctly placed.

---

## Open Risks

- **No vendor plugin SDK** — the widget is a companion window, not embedded; set user expectations accordingly.
- Spotify API access is shrinking — keep the app functional even if Spotify is removed entirely.
- rekordbox's encrypted DB limits live features — Serato-first is deliberate.
- Netease/YouTube downloading is a legal gray zone — links-only/manifest keeps us safe.
- Essentia.js embedding quality is "good, not perfect" — Phase 0 confirms it's good enough before we build on it.
- **Cold start for personalization** — with little play history the style model is weak; lean on feedback + archetypes until enough data accrues.
- **Named-DJ likeness** — keep strictly to "inspired by" style profiles; no logos, endorsement claims, or copied tracklists, especially once it's a product.
- **Song-structure detection is approximate** — technique coaching v2 timestamps may be imperfect; present as suggestions, not gospel.
- **Scope is the #1 project risk** — the 8-phase vision can swallow the project. Ship the ⭐ v1 slice first; treat everything else as optional upside.
- **Recommendation quality is unproven until measured** — the eval harness is what de-risks the *core value*; build it in v1, not "later."
- **Track identity is underestimated** — dupes/remixes/versions across local + streaming will make results feel broken if not handled (see Track Identity section).
- **Small eval set = noisy metric** — 30–50 labeled pairs makes precision@5 a *trend indicator*, not a truth; build negatives realistically (genre subfolders help) and don't over-tune to small deltas.
- **Library backup unconfirmed** — `~/Documents/dj` (78 GB) + Serato cues are career assets on one internal disk; confirm Time Machine (or similar) covers them before batch-processing thousands of files.
