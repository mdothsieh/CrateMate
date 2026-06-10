/**
 * ipc.ts — the SINGLE source of truth for what the UI may ask the backend.
 *
 * WHY THIS FILE EXISTS (security + sanity):
 * The React UI runs in a sandboxed Chromium page with NO Node access. The only
 * way it can touch your files/database is through the channels defined here,
 * exposed one-by-one in the preload script. There is deliberately no generic
 * "run anything" channel — every capability is named, typed, and validated in
 * the main process. (PLAN.md → Security Concerns → Electron hardening.)
 */

/** Channels the renderer can invoke (request → response). */
export const IPC = {
  PING: 'app:ping',
  /** Open the OS folder picker; returns the chosen path (or null if cancelled). */
  CHOOSE_FOLDER: 'library:choose-folder',
  /** Start (or resume) indexing a folder of MP3s. Incremental: already-analyzed files are skipped. */
  START_INDEX: 'library:start-index',
  /** Current library stats (counts, sources, last index time). */
  LIBRARY_STATS: 'library:stats',
  /** Dropped track → top mixable matches with reasons. Analyzes the file first if it's new. */
  FIND_SIMILAR: 'library:find-similar',
  /** Save dialog → write a Serato .crate (+ .m3u8 sibling) for the given tracks. Never writes into _Serato_. */
  EXPORT_CRATE: 'library:export-crate',
} as const

/** Events the MAIN process pushes to the renderer (no request needed). */
export const IPC_EVENTS = {
  /** Fired per analyzed file during indexing + once with phase 'done'. */
  INDEX_PROGRESS: 'library:index-progress',
} as const

export interface PingResponse {
  ok: boolean
  version: string
  uptimeMs: number
}

export interface IndexProgress {
  phase: 'scanning' | 'analyzing' | 'done' | 'error'
  /** files analyzed so far (incl. skipped) */
  done: number
  total: number
  skipped: number
  errors: number
  /** basename of the file just finished — for the "now analyzing…" line */
  currentFile?: string
  /** only on phase 'error' */
  message?: string
  /** ms elapsed since indexing started */
  elapsedMs: number
}

export interface LibraryStats {
  tracks: number
  withSeratoBpmKey: number
  withEmbedding: number
  lastIndexedAt: number | null
  libraryFolder: string | null
}

export interface StartIndexResult {
  started: boolean
  /** false start reason, e.g. another index already running */
  reason?: string
}

export interface TrackSummary {
  id: number
  path: string
  filename: string
  title: string | null
  artist: string | null
  durationS: number | null
  bpm: number | null
  camelot: string | null
  energyDb: number | null
  bpmKeySource: string | null
}

export interface SimilarMatch extends TrackSummary {
  /** 0..1 blended score (style/bpm/key/energy) */
  score: number
  /** human-readable WHY chips, e.g. "vibe 87%", "126 → 124 BPM", "same key 8A" */
  reasons: string[]
}

export interface FindSimilarResult {
  query: TrackSummary
  matches: SimilarMatch[]
}

export interface ExportCrateResult {
  /** false = user cancelled the save dialog OR something went wrong (see reason) */
  saved: boolean
  reason?: string
  /** absolute paths of what was written, for the "saved to…" confirmation */
  cratePath?: string
  m3u8Path?: string
}

/**
 * The API surface the preload script exposes as `window.cratemate`.
 * The renderer imports this TYPE (not the implementation) for full
 * autocomplete + compile-time safety on both sides of the bridge.
 */
export interface CrateMateApi {
  ping(): Promise<PingResponse>
  chooseFolder(): Promise<string | null>
  startIndex(folder: string): Promise<StartIndexResult>
  libraryStats(): Promise<LibraryStats>
  /** Subscribe to indexing progress; returns an unsubscribe function. */
  onIndexProgress(cb: (p: IndexProgress) => void): () => void
  /**
   * Resolve a dropped File object to its absolute path. Sandboxed renderers
   * can't see paths; Electron's webUtils (preload-only) can.
   */
  getFilePath(file: File): string
  findSimilar(path: string): Promise<FindSimilarResult>
  /**
   * Export tracks as a Serato .crate + .m3u8. `trackPaths` = library paths in
   * play order; `suggestedName` seeds the save dialog's filename.
   */
  exportCrate(trackPaths: string[], suggestedName: string): Promise<ExportCrateResult>
}
