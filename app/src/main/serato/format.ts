/**
 * serato/format.ts — parser for Serato's binary library files (READ-ONLY).
 *
 * Proven in the Phase 0 spike (spike-phase0-2026-06-10/serato-format.js) on
 * the real library. All Serato files share one unencrypted TLV layout:
 *
 *   [4 ASCII chars tag][4-byte big-endian length][<length> bytes payload] …
 *
 * Tag's first letter = payload type:
 *   o… container (nested chunks) · t…/p… UTF-16BE string · u… uint32
 *   s… uint16 · b… bool byte
 *
 * HOUSE RULE: this module only ever READS. Nothing in CrateMate writes
 * inside `~/Music/_Serato_/` (PLAN.md → Security → File handling).
 */
import fs from 'node:fs'

export interface Chunk {
  tag: string
  payload: Buffer
}

/** Split a buffer into top-level chunks; stops safely on truncated/corrupt data. */
export function parseChunks(buf: Buffer): Chunk[] {
  const chunks: Chunk[] = []
  let offset = 0
  while (offset + 8 <= buf.length) {
    const tag = buf.toString('ascii', offset, offset + 4)
    const len = buf.readUInt32BE(offset + 4)
    if (offset + 8 + len > buf.length) break // half-parsed beats crashed
    chunks.push({ tag, payload: buf.subarray(offset + 8, offset + 8 + len) })
    offset += 8 + len
  }
  return chunks
}

/** UTF-16 big-endian → string (Node natively only speaks little-endian). */
export function utf16be(payload: Buffer): string {
  return Buffer.from(payload).swap16().toString('utf16le')
}

export type SeratoValue = string | number | boolean | Buffer | SeratoRecord
export interface SeratoRecord {
  [tag: string]: SeratoValue | SeratoValue[]
}

function decodeValue(tag: string, payload: Buffer): SeratoValue {
  switch (tag[0]) {
    case 't':
    case 'p': return utf16be(payload)
    case 'u': return payload.length >= 4 ? payload.readUInt32BE(0) : 0
    case 's': return payload.length >= 2 ? payload.readUInt16BE(0) : 0
    case 'b': return payload.length >= 1 ? payload[0] !== 0 : false
    case 'o': return containerToObject(payload)
    default: return payload // unknown → raw bytes
  }
}

/** Container chunk → plain object; repeated tags collect into arrays. */
export function containerToObject(payload: Buffer): SeratoRecord {
  const obj: SeratoRecord = {}
  for (const { tag, payload: inner } of parseChunks(payload)) {
    const value = decodeValue(tag, inner)
    const existing = obj[tag]
    if (existing !== undefined) {
      if (Array.isArray(existing)) existing.push(value)
      else obj[tag] = [existing, value]
    } else {
      obj[tag] = value
    }
  }
  return obj
}

/** Parse a whole Serato file → its version string + one object per 'o…' record. */
export function parseSeratoFile(filePath: string): { version: string | null; records: Array<{ type: string } & SeratoRecord> } {
  const buf = fs.readFileSync(filePath)
  let version: string | null = null
  const records: Array<{ type: string } & SeratoRecord> = []
  for (const { tag, payload } of parseChunks(buf)) {
    if (tag === 'vrsn') version = utf16be(payload)
    else if (tag[0] === 'o') records.push({ type: tag, ...containerToObject(payload) })
  }
  return { version, records }
}
