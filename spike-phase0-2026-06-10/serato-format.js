/**
 * serato-format.js — shared parser for Serato's binary library files.
 *
 * WHY THIS EXISTS (Phase 0 spike):
 * Serato has no API, but its library files (`database V2`, `Subcrates/*.crate`,
 * `History/*`) all use one simple, unencrypted "TLV" (Tag-Length-Value) layout:
 *
 *   ┌──────────────┬───────────────────────┬───────────────────┐
 *   │ 4 ASCII chars │ 4-byte big-endian len │  <len> bytes data │
 *   │  (the "tag")  │   (payload length)    │   (the payload)   │
 *   └──────────────┴───────────────────────┴───────────────────┘
 *   ... repeated back-to-back until end of file.
 *
 * The FIRST LETTER of each tag tells you the payload type:
 *   o…  = "object"/container → the payload is itself a list of nested chunks
 *   t…  = text   → UTF-16 BIG-endian string (e.g. tsng = song title)
 *   p…  = path   → UTF-16 BIG-endian string (e.g. pfil = file path)
 *   u…  = uint32 → 4-byte big-endian integer (e.g. uadd = date added)
 *   s…  = uint16 → 2-byte integer
 *   b…  = bool   → 1 byte
 *   r…  = uint32 (rarely seen)
 *
 * This was reverse-engineered by the community years ago and is stable across
 * Serato versions — it's the foundation the whole app reads libraries through.
 * We only ever READ these files; CrateMate never writes into `_Serato_`.
 */
const fs = require('fs');

/**
 * Split a buffer into its top-level [tag, payload] chunks.
 * Defensive: if a declared length would run past the end of the buffer
 * (corrupt file / our misunderstanding), we stop instead of throwing —
 * a half-parsed library is more useful than a crash.
 */
function parseChunks(buf) {
  const chunks = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const tag = buf.toString('ascii', offset, offset + 4);
    const len = buf.readUInt32BE(offset + 4);
    if (offset + 8 + len > buf.length) break; // truncated/corrupt — bail safely
    chunks.push({ tag, payload: buf.subarray(offset + 8, offset + 8 + len) });
    offset += 8 + len;
  }
  return chunks;
}

/** Decode a UTF-16 big-endian payload to a JS string (Node only does little-endian natively, so we swap byte pairs first). */
function utf16be(payload) {
  return Buffer.from(payload).swap16().toString('utf16le');
}

/** Decode one leaf chunk's payload based on its tag's first letter (see table above). */
function decodeValue(tag, payload) {
  switch (tag[0]) {
    case 't':
    case 'p': return utf16be(payload);
    case 'u': return payload.length >= 4 ? payload.readUInt32BE(0) : null;
    case 's': return payload.length >= 2 ? payload.readUInt16BE(0) : null;
    case 'b': return payload.length >= 1 ? payload[0] !== 0 : null;
    case 'r': return payload.length >= 4 ? payload.readUInt32BE(0) : null;
    default:  return payload; // unknown type → keep raw bytes for inspection
  }
}

/**
 * Turn a container chunk ('o…') into a plain JS object: { tagName: decodedValue }.
 * If a tag repeats inside one container, values collect into an array.
 */
function containerToObject(payload) {
  const obj = {};
  for (const { tag, payload: inner } of parseChunks(payload)) {
    const value = tag[0] === 'o' ? containerToObject(inner) : decodeValue(tag, inner);
    if (tag in obj) {
      if (!Array.isArray(obj[tag])) obj[tag] = [obj[tag]];
      obj[tag].push(value);
    } else {
      obj[tag] = value;
    }
  }
  return obj;
}

/**
 * Parse any Serato library file into { version, records, tagCounts }.
 * - `records` = one object per top-level container ('otrk' = track, 'oent' = history entry, …)
 * - `tagCounts` = how often each top-level tag appeared (handy for exploring unknown files)
 */
function parseSeratoFile(filePath) {
  const buf = fs.readFileSync(filePath);
  let version = null;
  const records = [];
  const tagCounts = {};
  for (const { tag, payload } of parseChunks(buf)) {
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    if (tag === 'vrsn') version = utf16be(payload);
    else if (tag[0] === 'o') records.push({ type: tag, ...containerToObject(payload) });
  }
  return { version, records, tagCounts };
}

module.exports = { parseChunks, parseSeratoFile, containerToObject, decodeValue, utf16be };
