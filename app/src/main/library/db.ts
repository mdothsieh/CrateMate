/**
 * library/db.ts — the SQLite feature index (the app's one source of truth).
 *
 * Lives in Electron's userData dir (~/Library/Application Support/cratemate/),
 * NOT in the repo and NOT in the music folder — it's personal data
 * (PLAN.md → "local-only, you own your data").
 *
 * One row per MP3. The embedding is a 1280-float vector (Discogs-EffNet)
 * stored as a BLOB; similarity search loads all vectors into memory — at
 * ~5 MB per 1,000 tracks that stays trivial for any personal library.
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'

export interface TrackRow {
  id: number
  path: string
  filename: string
  title: string | null
  artist: string | null
  durationS: number | null
  bpm: number | null
  keyRaw: string | null
  camelot: string | null
  /** where bpm/key came from: 'serato' (imported) or 'essentia' (computed) */
  bpmKeySource: 'serato' | 'essentia' | null
  /** mean RMS loudness in dBFS over the analysis window — the v1 "energy" */
  energyDb: number | null
  embedding: Buffer | null
  fileMtimeMs: number
  fileSize: number
  analyzedAt: number
}

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(path.join(app.getPath('userData'), 'cratemate.sqlite'))
  db.pragma('journal_mode = WAL') // safe concurrent reads while indexing writes
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id            INTEGER PRIMARY KEY,
      path          TEXT NOT NULL UNIQUE,
      filename      TEXT NOT NULL,
      title         TEXT,
      artist        TEXT,
      durationS     REAL,
      bpm           REAL,
      keyRaw        TEXT,
      camelot       TEXT,
      bpmKeySource  TEXT CHECK (bpmKeySource IN ('serato','essentia')),
      energyDb      REAL,
      embedding     BLOB,
      fileMtimeMs   REAL NOT NULL,
      fileSize      INTEGER NOT NULL,
      analyzedAt    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `)
  return db
}

/** A file is "already indexed" if path+mtime+size all match — the incremental check. */
export function isUpToDate(filePath: string, mtimeMs: number, size: number): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM tracks WHERE path = ? AND fileMtimeMs = ? AND fileSize = ? AND embedding IS NOT NULL')
    .get(filePath, mtimeMs, size)
  return row !== undefined
}

export function upsertTrack(t: Omit<TrackRow, 'id'>): void {
  getDb().prepare(`
    INSERT INTO tracks (path, filename, title, artist, durationS, bpm, keyRaw, camelot,
                        bpmKeySource, energyDb, embedding, fileMtimeMs, fileSize, analyzedAt)
    VALUES (@path, @filename, @title, @artist, @durationS, @bpm, @keyRaw, @camelot,
            @bpmKeySource, @energyDb, @embedding, @fileMtimeMs, @fileSize, @analyzedAt)
    ON CONFLICT(path) DO UPDATE SET
      filename=@filename, title=@title, artist=@artist, durationS=@durationS,
      bpm=@bpm, keyRaw=@keyRaw, camelot=@camelot, bpmKeySource=@bpmKeySource,
      energyDb=@energyDb, embedding=@embedding, fileMtimeMs=@fileMtimeMs,
      fileSize=@fileSize, analyzedAt=@analyzedAt
  `).run(t)
}

/** Metadata for a set of library paths (used by the .m3u8 export's EXTINF lines). */
export function getTracksByPaths(paths: string[]): Map<string, Pick<TrackRow, 'path' | 'artist' | 'title' | 'durationS'>> {
  const stmt = getDb().prepare('SELECT path, artist, title, durationS FROM tracks WHERE path = ?')
  const out = new Map<string, Pick<TrackRow, 'path' | 'artist' | 'title' | 'durationS'>>()
  for (const p of paths) {
    const row = stmt.get(p) as Pick<TrackRow, 'path' | 'artist' | 'title' | 'durationS'> | undefined
    if (row) out.set(p, row)
  }
  return out
}

export function getStats(): { tracks: number; withSeratoBpmKey: number; withEmbedding: number } {
  const d = getDb()
  return {
    tracks: (d.prepare('SELECT COUNT(*) c FROM tracks').get() as { c: number }).c,
    withSeratoBpmKey: (d.prepare("SELECT COUNT(*) c FROM tracks WHERE bpmKeySource = 'serato'").get() as { c: number }).c,
    withEmbedding: (d.prepare('SELECT COUNT(*) c FROM tracks WHERE embedding IS NOT NULL').get() as { c: number }).c,
  }
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(key: string, value: string): void {
  getDb().prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .run(key, value, value)
}
