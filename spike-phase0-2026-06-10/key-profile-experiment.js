/**
 * key-profile-experiment.js — Phase 0 sub-experiment: which Essentia key
 * profile best matches Serato's key analysis on THIS user's library?
 *
 * KeyExtractor's `profileType` changes the template it matches chroma against.
 * Candidates: 'bgate' (essentia default), 'edma'/'edmm' (tuned on electronic
 * dance music — 'edmm' biases minor), 'temperley', 'krumhansl' (classical MIR).
 *
 * We re-analyze the SAME 25 tracks from essentia-vs-serato.json and score each
 * profile two ways:
 *   strict      = exact Camelot match with Serato
 *   compatible  = same Camelot number (relative maj/min) or ±1 on the wheel —
 *                 i.e. "a DJ could still harmonically mix these" even if the
 *                 label differs.
 */
const fs = require('fs');
const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const esPkg = require('essentia.js');

const essentia = new esPkg.Essentia(esPkg.EssentiaWASM.EssentiaWASM || esPkg.EssentiaWASM);
const PROFILES = ['bgate', 'edma', 'edmm', 'temperley', 'krumhansl'];

const NOTE_TO_PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
const CAMELOT_MINOR = { 9: '8A', 4: '9A', 11: '10A', 6: '11A', 1: '12A', 8: '1A', 3: '2A', 10: '3A', 5: '4A', 0: '5A', 7: '6A', 2: '7A' };
const CAMELOT_MAJOR = { 0: '8B', 7: '9B', 2: '10B', 9: '11B', 4: '12B', 11: '1B', 6: '2B', 1: '3B', 8: '4B', 3: '5B', 10: '6B', 5: '7B' };

function toCamelot(keyStr) {
  if (!keyStr) return null;
  const s = String(keyStr).trim();
  if (/^\d{1,2}[AB]$/i.test(s)) return s.toUpperCase();
  const m = s.match(/^([A-G][#b]?)\s*(m|min|minor)?$/i);
  if (!m) return null;
  const pc = NOTE_TO_PC[m[1][0].toUpperCase() + (m[1][1] || '')];
  if (pc === undefined) return null;
  return m[2] ? CAMELOT_MINOR[pc] : CAMELOT_MAJOR[pc];
}

/** "Compatible" by Camelot mixing rules: same number (either ring) or ±1 same ring. */
function camelotCompatible(a, b) {
  if (!a || !b) return false;
  const [na, ra] = [parseInt(a), a.slice(-1)];
  const [nb, rb] = [parseInt(b), b.slice(-1)];
  if (na === nb) return true;                              // same number, any ring
  const dist = Math.min(Math.abs(na - nb), 12 - Math.abs(na - nb));
  return dist === 1 && ra === rb;                          // wheel neighbor, same ring
}

function decodeToPcm(file) {
  const res = spawnSync(ffmpegPath, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '44100', '-f', 'f32le', 'pipe:1'],
    { maxBuffer: 1024 * 1024 * 512 });
  if (res.status !== 0) throw new Error(`ffmpeg failed`);
  return new Float32Array(res.stdout.buffer, res.stdout.byteOffset, res.stdout.length / 4);
}

const prior = JSON.parse(fs.readFileSync('essentia-vs-serato.json', 'utf8'))
  .filter((r) => r.seratoCamelot && r.seratoBpm > 0); // drop the BPM-0 sound effect

// Find each file's full path back via the Serato DB (prior results only kept basenames)
const { parseSeratoFile } = require('./serato-format');
const path = require('path');
const os = require('os');
const db = parseSeratoFile(path.join(os.homedir(), 'Music', '_Serato_', 'database V2'));
const byBase = new Map(db.records.filter((r) => r.type === 'otrk' && r.pfil).map((r) => [path.basename(r.pfil), '/' + r.pfil]));

const score = Object.fromEntries(PROFILES.map((p) => [p, { strict: 0, compatible: 0 }]));
let n = 0;

for (const row of prior) {
  const file = byBase.get(row.file);
  if (!file || !fs.existsSync(file)) continue;
  const pcm = decodeToPcm(file);
  n++;
  for (const profile of PROFILES) {
    const vec = essentia.arrayToVector(pcm);
    // KeyExtractor positional args up to profileType (rest = defaults)
    const r = essentia.KeyExtractor(vec, true, 4096, 4096, 12, 3500, 60, 25, 0.2, profile);
    vec.delete();
    const cam = toCamelot(`${r.key}${r.scale === 'minor' ? 'm' : ''}`);
    if (cam === row.seratoCamelot) score[profile].strict++;
    if (camelotCompatible(cam, row.seratoCamelot)) score[profile].compatible++;
  }
  process.stdout.write(`.`);
}

console.log(`\n\n=== key-profile agreement with Serato over ${n} tracks ===`);
console.log(`profile      strict   mix-compatible`);
for (const p of PROFILES) {
  console.log(`${p.padEnd(12)} ${String(score[p].strict).padStart(2)}/${n}     ${String(score[p].compatible).padStart(2)}/${n}`);
}
