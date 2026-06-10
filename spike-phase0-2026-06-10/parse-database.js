/**
 * parse-database.js — Phase 0 spike, item 2: read Serato's `database V2`.
 *
 * WHY THIS MATTERS: Serato has ALREADY analyzed the user's whole library —
 * each 'otrk' record carries Serato's own BPM ('tbpm') and key ('tkey').
 * That gives us (a) a free, large-scale ground-truth corpus to validate
 * Essentia against, and (b) a candidate import source so CrateMate never
 * displays numbers that disagree with what the user sees in Serato.
 *
 * Known 'otrk' fields (community reverse-engineering, confirmed below by dump):
 *   pfil = file path        tsng = title          tart = artist
 *   tbpm = BPM (string)     tkey = key (string)   tgen = genre
 *   tlen = length           tbit = bitrate        tsmp = sample rate
 *   uadd = date added       talb = album          ttyp = file type ("mp3")
 *
 * Usage:  node parse-database.js           → summary + field stats
 *         node parse-database.js --dump N  → print N full records to inspect
 */
const path = require('path');
const os = require('os');
const { parseSeratoFile } = require('./serato-format');

const DB_PATH = path.join(os.homedir(), 'Music', '_Serato_', 'database V2');

const { version, records, tagCounts } = parseSeratoFile(DB_PATH);
const tracks = records.filter((r) => r.type === 'otrk');

console.log(`version: ${version}`);
console.log(`top-level tags: ${JSON.stringify(tagCounts)}`);
console.log(`track records: ${tracks.length}`);

// --dump N: print raw records so we can verify the field guesses above
const dumpIdx = process.argv.indexOf('--dump');
if (dumpIdx !== -1) {
  const n = parseInt(process.argv[dumpIdx + 1] || '3', 10);
  for (const t of tracks.slice(0, n)) {
    // Buffers print as noise — summarize them instead
    const clean = Object.fromEntries(
      Object.entries(t).map(([k, v]) => [k, Buffer.isBuffer(v) ? `<${v.length} raw bytes>` : v])
    );
    console.log(JSON.stringify(clean, null, 2));
  }
  process.exit(0);
}

// Field coverage: which fields exist, and how many tracks have them?
// (Tells us how much of the library Serato has actually analyzed.)
const fieldCounts = {};
for (const t of tracks) {
  for (const k of Object.keys(t)) {
    if (k === 'type') continue;
    fieldCounts[k] = (fieldCounts[k] || 0) + 1;
  }
}
console.log('\nfield coverage (count of tracks having each field):');
for (const [k, c] of Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${c}`);
}

// The numbers we actually care about for Phase 0:
const isMp3 = (t) => t.pfil && t.pfil.toLowerCase().endsWith('.mp3');
const mp3s = tracks.filter(isMp3);
const withBpm = mp3s.filter((t) => t.tbpm && String(t.tbpm).trim() !== '');
const withKey = mp3s.filter((t) => t.tkey && String(t.tkey).trim() !== '');
const inDjFolder = mp3s.filter((t) => t.pfil.includes('Documents/dj'));

console.log(`\nMP3 tracks: ${mp3s.length}`);
console.log(`  with Serato BPM: ${withBpm.length}`);
console.log(`  with Serato key: ${withKey.length}`);
console.log(`  under Documents/dj: ${inDjFolder.length}`);

console.log('\nsample analyzed MP3s (path | bpm | key):');
withKey.slice(0, 8).forEach((t) => console.log(`  ${path.basename(t.pfil)} | ${t.tbpm} | ${t.tkey}`));

// Distinct key spellings — tells us whether Serato uses musical (Am) or Camelot (8A) notation,
// which decides how our Camelot-compatibility filter must translate values.
const keySpellings = [...new Set(withKey.map((t) => String(t.tkey)))].sort();
console.log(`\ndistinct key spellings (${keySpellings.length}): ${keySpellings.join(', ')}`);
