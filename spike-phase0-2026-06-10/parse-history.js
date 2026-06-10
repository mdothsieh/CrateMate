/**
 * parse-history.js — Phase 0 spike, item 3: read Serato play history.
 *
 * WHY: play history is the data source for the Phase 5 personal style model
 * ("learn how I DJ"). We need to confirm now that real track sequences with
 * timestamps are extractable — otherwise that whole feature has no fuel.
 *
 * Layout (community knowledge, verified by the dumps below):
 *  - History/history.database : TLV index of sessions ('oses' records).
 *  - History/Sessions/N.session : one file per DJ session. Each track played is
 *    an 'oent' container holding one 'adat' blob. Inside 'adat' the format
 *    CHANGES: fields are [uint32 field-ID][uint32 length][value] — numeric IDs
 *    instead of ASCII tags. Strings are UTF-16BE, numbers are big-endian.
 *
 * Usage:  node parse-history.js              → newest session, decoded
 *         node parse-history.js --raw        → dump field IDs to identify them
 *         node parse-history.js --file N     → specific Sessions/N.session
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseChunks, utf16be } = require('./serato-format');

const HISTORY_DIR = path.join(os.homedir(), 'Music', '_Serato_', 'History');
const SESSIONS_DIR = path.join(HISTORY_DIR, 'Sessions');

// Field-ID map for the 'adat' blob (IDs verified against --raw dumps of real
// sessions; unknown IDs are simply ignored by the decoder below).
const ADAT_FIELDS = {
  2:  { name: 'filePath',  type: 'string' },
  6:  { name: 'title',     type: 'string' },
  7:  { name: 'artist',    type: 'string' },
  8:  { name: 'album',     type: 'string' },
  9:  { name: 'genre',     type: 'string' },
  17: { name: 'sourceUrl', type: 'string' }, // e.g. SoundCloud link for streamed tracks
  28: { name: 'startTime', type: 'uint32' }, // unix epoch seconds
  29: { name: 'endTime',   type: 'uint32' },
  31: { name: 'deck',      type: 'uint32' }, // which deck it played on (1/2)
  45: { name: 'playTime',  type: 'uint32' }, // seconds the deck played it
  48: { name: 'sessionId', type: 'uint32' },
  50: { name: 'played',    type: 'bool' },
  51: { name: 'key',       type: 'string' },
  63: { name: 'device',    type: 'string' }, // e.g. "Offline Player" vs controller name
};

/** Parse one 'adat' payload: repeating [uint32 id][uint32 len][value]. */
function parseAdat(buf, raw = false) {
  const out = {};
  const rawFields = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const id = buf.readUInt32BE(off);
    const len = buf.readUInt32BE(off + 4);
    if (off + 8 + len > buf.length) break;
    const val = buf.subarray(off + 8, off + 8 + len);
    if (raw) {
      // For identification: show every plausible decoding of the value
      rawFields.push({
        id, len,
        asString: len % 2 === 0 ? utf16be(val).replace(/\0+$/, '') : null,
        asUint32: len === 4 ? val.readUInt32BE(0) : null,
      });
    }
    const known = ADAT_FIELDS[id];
    if (known) {
      if (known.type === 'string') out[known.name] = utf16be(val).replace(/\0+$/, '');
      else if (known.type === 'uint32' && len >= 4) out[known.name] = val.readUInt32BE(0);
      else if (known.type === 'bool' && len >= 1) out[known.name] = val[0] !== 0;
    }
    off += 8 + len;
  }
  return raw ? rawFields : out;
}

/** Parse a .session file into an ordered list of played-track entries. */
function parseSession(sessionPath, raw = false) {
  const buf = fs.readFileSync(sessionPath);
  const entries = [];
  for (const { tag, payload } of parseChunks(buf)) {
    if (tag !== 'oent') continue;
    for (const inner of parseChunks(payload)) {
      if (inner.tag === 'adat') entries.push(parseAdat(inner.payload, raw));
    }
  }
  return entries;
}

// ---- main ----
const args = process.argv.slice(2);
const raw = args.includes('--raw');
const fileArgIdx = args.indexOf('--file');

let sessionPath;
if (fileArgIdx !== -1) {
  sessionPath = path.join(SESSIONS_DIR, `${args[fileArgIdx + 1]}.session`);
} else {
  // Pick the most recently modified session = the user's latest real DJ session
  const newest = fs.readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith('.session'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  sessionPath = path.join(SESSIONS_DIR, newest.f);
}

console.log(`session file: ${sessionPath}`);
const entries = parseSession(sessionPath, raw);
console.log(`entries: ${entries.length}\n`);

if (raw) {
  // Identification mode: dump the first 2 entries' fields in every decoding
  for (const e of entries.slice(0, 2)) {
    console.log('--- entry ---');
    for (const f of e) {
      const s = f.asString && /^[\x20-￿]*$/.test(f.asString) && f.asString.length < 120 ? JSON.stringify(f.asString) : null;
      console.log(`  id=${f.id} len=${f.len} uint32=${f.asUint32} str=${s}`);
    }
  }
} else {
  for (const e of entries.slice(0, 15)) {
    const t = e.startTime ? new Date(e.startTime * 1000).toISOString() : '?';
    console.log(`  ${t}  ${e.artist || '?'} — ${e.title || '?'}  (bpm=${e.bpm || '?'}, key=${e.key || '?'}, played=${e.played}, playTime=${e.playTime ?? '?'}s)`);
  }
}
