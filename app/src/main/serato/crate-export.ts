/**
 * serato/crate-export.ts — WRITE side of Serato's `.crate` format (+ `.m3u8`).
 *
 * This is the mirror of format.ts (the read side): the same TLV layout,
 *   [4 ASCII chars tag][4-byte big-endian length][payload]
 * but built instead of parsed. Structure of a real crate (verified by parsing
 * the user's own `~/Music/_Serato_/Subcrates/*.crate` files, 2026-06-10):
 *
 *   vrsn  "1.0/Serato ScratchLive Crate"        (UTF-16BE string)
 *   osrt  > tvcn "#" + brev false               (sort column — optional)
 *   ovct  > tvcn "song" + tvcw "0"  (×N)        (visible columns — optional)
 *   otrk  > ptrk "Users/x/Documents/dj/a.mp3"   (one per track)
 *
 * The `ptrk` path is relative to the VOLUME ROOT with no leading slash —
 * that's how Serato makes crates portable across drives.
 *
 * HOUSE RULES (PLAN.md → Security → File handling):
 *   - We NEVER write inside `_Serato_` — the user exports to a folder of
 *     their choice and imports into Serato manually. Enforced here, not
 *     just promised.
 *   - All writes are atomic: write a temp file in the destination folder,
 *     then rename. A crash mid-write leaves no half-written crate.
 */
import fs from 'node:fs'
import path from 'node:path'

// ---------- TLV encoding (the inverse of format.ts's decoders) ----------

/** One chunk: 4-char tag + big-endian length + payload. */
function chunk(tag: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.write(tag, 0, 'ascii')
  header.writeUInt32BE(payload.length, 4)
  return Buffer.concat([header, payload])
}

/** String → UTF-16 big-endian (Node natively only writes little-endian, so swap). */
function utf16beEncode(s: string): Buffer {
  return Buffer.from(s, 'utf16le').swap16()
}

const stringChunk = (tag: string, s: string): Buffer => chunk(tag, utf16beEncode(s))
const boolChunk = (tag: string, v: boolean): Buffer => chunk(tag, Buffer.from([v ? 1 : 0]))
/** Container chunk: payload = its children concatenated. */
const container = (tag: string, children: Buffer[]): Buffer => chunk(tag, Buffer.concat(children))

// ---------- path handling ----------

/**
 * Absolute path → Serato's volume-root-relative form (no leading '/').
 *   /Users/x/dj/a.mp3          → Users/x/dj/a.mp3
 *   /Volumes/USB/dj/a.mp3      → dj/a.mp3   (relative to that drive's root)
 *
 * Caveat for the future: a crate referencing an EXTERNAL drive only resolves
 * when imported into that drive's own _Serato_ folder. The v1 library lives
 * on the boot volume (~/Documents/dj), so this is theory for now.
 */
export function toVolumeRelative(absPath: string): string {
  const external = /^\/Volumes\/[^/]+\//.exec(absPath)
  if (external) return absPath.slice(external[0].length)
  return absPath.replace(/^\//, '')
}

// ---------- guards + atomic write ----------

/** The one rule that protects a live DJ library: we never write into _Serato_. */
export function isInsideSeratoFolder(p: string): boolean {
  return p.split(path.sep).some((seg) => seg.toLowerCase() === '_serato_')
}

/** Write via temp-file-then-rename so a crash can't leave a torn file. */
function writeAtomic(destPath: string, data: Buffer | string): void {
  const tmp = path.join(path.dirname(destPath), `.cratemate-tmp-${process.pid}-${Date.now()}`)
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, destPath) // rename on the same volume is atomic on macOS/POSIX
}

// ---------- the exports ----------

/** Columns Serato shows when the crate opens — matches the user's real crates. */
const DEFAULT_COLUMNS = ['song', 'artist', 'bpm', 'key']

/**
 * Build + atomically write a `.crate` file listing the given absolute paths.
 * Throws if the destination is inside a _Serato_ folder.
 */
export function writeCrateFile(destPath: string, trackAbsPaths: string[]): void {
  if (isInsideSeratoFolder(destPath)) {
    throw new Error('refusing to write inside a _Serato_ folder — export elsewhere and import manually')
  }
  const parts: Buffer[] = [
    stringChunk('vrsn', '1.0/Serato ScratchLive Crate'),
    // Sort by the '#' column, not reversed — what a freshly made Serato crate has.
    container('osrt', [stringChunk('tvcn', '#'), boolChunk('brev', false)]),
    ...DEFAULT_COLUMNS.map((c) => container('ovct', [stringChunk('tvcn', c), stringChunk('tvcw', '0')])),
    ...trackAbsPaths.map((p) => container('otrk', [stringChunk('ptrk', toVolumeRelative(p))])),
  ]
  writeAtomic(destPath, Buffer.concat(parts))
}

export interface M3u8Track {
  path: string
  artist: string | null
  title: string | null
  durationS: number | null
}

/**
 * Write the universal-playlist sibling (`.m3u8` = UTF-8 M3U): plays in
 * Apple Music/VLC/rekordbox — the "works everywhere" half of the export.
 */
export function writeM3u8File(destPath: string, tracks: M3u8Track[]): void {
  if (isInsideSeratoFolder(destPath)) {
    throw new Error('refusing to write inside a _Serato_ folder — export elsewhere and import manually')
  }
  const lines = ['#EXTM3U']
  for (const t of tracks) {
    const label = t.artist && t.title ? `${t.artist} - ${t.title}` : (t.title ?? path.basename(t.path))
    lines.push(`#EXTINF:${t.durationS ? Math.round(t.durationS) : -1},${label}`)
    lines.push(t.path) // m3u8 uses plain absolute paths
  }
  writeAtomic(destPath, lines.join('\n') + '\n')
}
