/**
 * parse-crate.js — Phase 0 spike, item 1: read a real Serato crate.
 *
 * A `.crate` file is just the shared TLV format where each 'otrk' container
 * holds a 'ptrk' (track path, relative to the volume root — no leading '/').
 *
 * Usage:  node parse-crate.js "<path to .crate>"
 *         node parse-crate.js            (defaults to listing every subcrate)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseSeratoFile } = require('./serato-format');

const SUBCRATES_DIR = path.join(os.homedir(), 'Music', '_Serato_', 'Subcrates');

function readCrate(cratePath) {
  const { version, records, tagCounts } = parseSeratoFile(cratePath);
  // 'ptrk' paths are stored relative to the volume root (e.g. "Users/x/Documents/dj/a.mp3")
  // so we prepend '/' to get a usable absolute path on the boot volume.
  const tracks = records
    .filter((r) => r.type === 'otrk' && r.ptrk)
    .map((r) => '/' + r.ptrk);
  return { version, tracks, tagCounts };
}

const target = process.argv[2];
const crates = target
  ? [target]
  : fs.readdirSync(SUBCRATES_DIR).filter((f) => f.endsWith('.crate')).map((f) => path.join(SUBCRATES_DIR, f));

for (const cratePath of crates) {
  const { version, tracks, tagCounts } = readCrate(cratePath);
  console.log(`\n=== ${path.basename(cratePath)} ===`);
  console.log(`version: ${version}`);
  console.log(`top-level tags: ${JSON.stringify(tagCounts)}`);
  console.log(`tracks: ${tracks.length}`);
  // Show first 5 + check the files actually exist on disk (proves paths decode correctly)
  tracks.slice(0, 5).forEach((t, i) => console.log(`  ${i + 1}. [${fs.existsSync(t) ? 'EXISTS' : 'MISSING'}] ${t}`));
}
