/**
 * analyze-mp3.js — Phase 0 spike, item 4: Essentia.js BPM/key on real MP3s,
 * compared against Serato's own analysis from `database V2`.
 *
 * PIPELINE (same one the real app will use):
 *   MP3 ──ffmpeg-static──▶ raw mono PCM float32 @ 44.1kHz ──▶ Essentia.js (WASM)
 *        (decode only)                                         RhythmExtractor2013 → BPM
 *                                                              KeyExtractor        → key + scale
 *
 * WHY COMPARE TO SERATO: Serato already analyzed all 1,344 MP3s. If Essentia
 * agrees with Serato most of the time, the engine is trustworthy AND we can
 * show users numbers that match their Serato screen. If it doesn't, v1 should
 * import Serato's values and use Essentia only for what Serato lacks
 * (energy, style embeddings).
 *
 * Usage:  node analyze-mp3.js "<file.mp3>"      → analyze one file
 *         node analyze-mp3.js --sample N        → N random Serato-analyzed MP3s, agreement stats
 */
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');
const esPkg = require('essentia.js');
const { parseSeratoFile } = require('./serato-format');

// essentia.js packaging differs across versions — handle both shapes.
const essentia = new esPkg.Essentia(esPkg.EssentiaWASM.EssentiaWASM || esPkg.EssentiaWASM);

const SAMPLE_RATE = 44100;

/** Decode an MP3 to mono float32 PCM using the bundled ffmpeg (no system install needed). */
function decodeToPcm(file) {
  const t0 = Date.now();
  const res = spawnSync(ffmpegPath, [
    '-v', 'error',
    '-i', file,
    '-ac', '1',              // mono — analysis doesn't need stereo
    '-ar', String(SAMPLE_RATE),
    '-f', 'f32le',           // raw 32-bit float samples, little-endian
    'pipe:1',
  ], { maxBuffer: 1024 * 1024 * 512 }); // allow up to ~512MB of PCM (≈50min audio)
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr}`);
  const pcm = new Float32Array(res.stdout.buffer, res.stdout.byteOffset, res.stdout.length / 4);
  return { pcm, decodeMs: Date.now() - t0 };
}

/** Run Essentia BPM + key on a PCM buffer. Returns values + compute time. */
function analyzePcm(pcm) {
  const t0 = Date.now();
  const vector = essentia.arrayToVector(pcm);
  // RhythmExtractor2013 = Essentia's recommended general-purpose tempo estimator
  const rhythm = essentia.RhythmExtractor2013(vector);
  // KeyExtractor with the default profile; returns e.g. { key: 'A', scale: 'minor', strength }
  const keyRes = essentia.KeyExtractor(vector);
  vector.delete(); // WASM memory is manual — leaking vectors crashes long runs
  return {
    bpm: rhythm.bpm,
    key: keyRes.key,
    scale: keyRes.scale,
    keyStrength: keyRes.strength,
    computeMs: Date.now() - t0,
  };
}

// ---------- key normalization (Serato mixes "Am"/"Abm" style and Camelot "11A") ----------
const NOTE_TO_PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
// Camelot wheel: minor keys = "A" ring, major = "B" ring.
const CAMELOT_MINOR = { 9: '8A', 4: '9A', 11: '10A', 6: '11A', 1: '12A', 8: '1A', 3: '2A', 10: '3A', 5: '4A', 0: '5A', 7: '6A', 2: '7A' };
const CAMELOT_MAJOR = { 0: '8B', 7: '9B', 2: '10B', 9: '11B', 4: '12B', 11: '1B', 6: '2B', 1: '3B', 8: '4B', 3: '5B', 10: '6B', 5: '7B' };

/** Normalize any key spelling ("Abm", "G#m", "11A", "A minor") → Camelot code, or null. */
function toCamelot(keyStr) {
  if (!keyStr) return null;
  const s = String(keyStr).trim();
  if (/^\d{1,2}[AB]$/i.test(s)) return s.toUpperCase();          // already Camelot
  const m = s.match(/^([A-G][#b]?)\s*(m|min|minor)?$/i);
  if (!m) return null;
  const pc = NOTE_TO_PC[m[1][0].toUpperCase() + (m[1][1] || '')];
  if (pc === undefined) return null;
  return m[2] ? CAMELOT_MINOR[pc] : CAMELOT_MAJOR[pc];
}

/** BPM agreement must tolerate half/double-time confusion — 70 vs 140 is the SAME groove,
 *  and every tempo estimator (Serato's included) picks one octave or the other. */
function bpmAgreement(a, b) {
  for (const mult of [1, 2, 0.5]) {
    if (Math.abs(a * mult - b) / b <= 0.03) return mult === 1 ? 'exact' : 'half/double';
  }
  return 'disagree';
}

function loadSeratoMp3s() {
  const dbPath = path.join(os.homedir(), 'Music', '_Serato_', 'database V2');
  return parseSeratoFile(dbPath).records.filter((r) =>
    r.type === 'otrk' && r.pfil && r.pfil.toLowerCase().endsWith('.mp3') &&
    r.tbpm && r.tkey && fs.existsSync('/' + r.pfil)
  );
}

function analyzeOne(file, serato) {
  const { pcm, decodeMs } = decodeToPcm(file);
  const r = analyzePcm(pcm);
  const durationS = (pcm.length / SAMPLE_RATE).toFixed(0);
  const essKey = `${r.key}${r.scale === 'minor' ? 'm' : ''}`;
  const line = {
    file: path.basename(file),
    durationS: Number(durationS),
    essentiaBpm: Number(r.bpm.toFixed(1)),
    essentiaKey: essKey,
    essentiaCamelot: toCamelot(essKey),
    keyStrength: Number(r.keyStrength.toFixed(2)),
    decodeMs, computeMs: r.computeMs,
  };
  if (serato) {
    line.seratoBpm = Number(parseFloat(serato.tbpm).toFixed(1));
    line.seratoKey = serato.tkey;
    line.seratoCamelot = toCamelot(serato.tkey);
    line.bpmMatch = bpmAgreement(line.essentiaBpm, line.seratoBpm);
    line.keyMatch = line.essentiaCamelot && line.essentiaCamelot === line.seratoCamelot;
  }
  return line;
}

// ---- main ----
const args = process.argv.slice(2);
const sampleIdx = args.indexOf('--sample');

if (sampleIdx === -1) {
  // Single-file mode
  const file = args[0];
  const tracks = loadSeratoMp3s();
  const serato = tracks.find((t) => '/' + t.pfil === file);
  console.log(JSON.stringify(analyzeOne(file, serato), null, 2));
} else {
  // Batch agreement mode: N random Serato-analyzed MP3s
  const n = parseInt(args[sampleIdx + 1] || '10', 10);
  const tracks = loadSeratoMp3s();
  // Deterministic shuffle (seeded by index hash) so reruns hit the same sample
  const sample = tracks
    .map((t, i) => ({ t, r: Math.sin(i * 9301 + 49297) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, n)
    .map((x) => x.t);

  const results = [];
  for (const s of sample) {
    const file = '/' + s.pfil;
    try {
      const line = analyzeOne(file, s);
      results.push(line);
      console.log(`${line.bpmMatch === 'disagree' ? '✗' : '✓'}bpm ${line.keyMatch ? '✓' : '✗'}key  es=${line.essentiaBpm}/${line.essentiaCamelot}  serato=${line.seratoBpm}/${line.seratoCamelot}  ${line.decodeMs + line.computeMs}ms  ${line.file}`);
    } catch (e) {
      console.log(`ERROR ${path.basename(file)}: ${e.message.slice(0, 100)}`);
    }
  }

  const ok = (k) => results.filter(k).length;
  console.log(`\n=== agreement over ${results.length} tracks ===`);
  console.log(`BPM exact:        ${ok((r) => r.bpmMatch === 'exact')}`);
  console.log(`BPM half/double:  ${ok((r) => r.bpmMatch === 'half/double')}`);
  console.log(`BPM disagree:     ${ok((r) => r.bpmMatch === 'disagree')}`);
  console.log(`Key match:        ${ok((r) => r.keyMatch)} / ${results.length}`);
  const avg = (f) => Math.round(results.reduce((a, r) => a + f(r), 0) / results.length);
  console.log(`avg decode ${avg((r) => r.decodeMs)}ms + compute ${avg((r) => r.computeMs)}ms per track`);
  console.log(`projected full first-run (1,344 MP3s, serial): ~${Math.round((avg((r) => r.decodeMs) + avg((r) => r.computeMs)) * 1344 / 60000)} min`);
  fs.writeFileSync('essentia-vs-serato.json', JSON.stringify(results, null, 2));
  console.log('details → essentia-vs-serato.json');
}
