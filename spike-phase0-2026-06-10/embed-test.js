/**
 * embed-test.js — Phase 0 spike, item 5: do style embeddings actually work
 * on THIS user's genres (KPOP / C-pop / open-format)?
 *
 * PIPELINE:
 *   MP3 ──ffmpeg──▶ mono PCM @ 16kHz (middle 90s of the track)
 *       ──essentia.js TensorflowInputMusiCNN──▶ 96 mel bands per 512-sample frame (hop 256)
 *       ──stack 128 frames per patch──▶ tensor [n, 128, 96]
 *       ──ONNX Discogs-EffNet──▶ [n, 1280] embeddings ──mean-pool + L2──▶ one 1280-d vector per track
 *
 * TEST: cosine-similarity matrix over 4 C-pop chill + 4 KPOP + 4 open-format
 * party tracks. PASS = within-genre similarity clearly above cross-genre.
 * (Middle 90s only: enough signal for style, ~6x faster than full track.)
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpegPath = require('ffmpeg-static');
const esPkg = require('essentia.js');
const ort = require('onnxruntime-node');

const essentia = new esPkg.Essentia(esPkg.EssentiaWASM.EssentiaWASM || esPkg.EssentiaWASM);

const SR = 16000;          // model was trained on 16kHz input
const FRAME = 512, HOP = 256, MELS = 96, PATCH = 128;
const DJ = path.join(os.homedir(), 'Documents', 'dj');

function decode16k(file) {
  const res = spawnSync(ffmpegPath, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'],
    { maxBuffer: 1024 * 1024 * 256 });
  if (res.status !== 0) throw new Error(`ffmpeg failed on ${file}`);
  return new Float32Array(res.stdout.buffer, res.stdout.byteOffset, res.stdout.length / 4);
}

/** Middle 90 seconds — skips intros/outros, captures the track's core style. */
function middle90(pcm) {
  const want = 90 * SR;
  if (pcm.length <= want) return pcm;
  const start = Math.floor((pcm.length - want) / 2);
  return pcm.subarray(start, start + want);
}

/** PCM → mel patches [n][128][96] using the exact frontend the model expects. */
function melPatches(pcm) {
  const frames = [];
  for (let start = 0; start + FRAME <= pcm.length; start += HOP) {
    const frameVec = essentia.arrayToVector(pcm.subarray(start, start + FRAME));
    // TensorflowInputMusiCNN = essentia's canonical 96-band mel frontend for these models
    const mel = essentia.TensorflowInputMusiCNN(frameVec);
    frames.push(essentia.vectorToArray(mel.bands));
    frameVec.delete();
    mel.bands.delete();
  }
  const nPatches = Math.floor(frames.length / PATCH);
  const data = new Float32Array(nPatches * PATCH * MELS);
  for (let p = 0; p < nPatches; p++)
    for (let f = 0; f < PATCH; f++)
      data.set(frames[p * PATCH + f], (p * PATCH + f) * MELS);
  return { data, nPatches };
}

async function trackEmbedding(session, file) {
  const pcm = middle90(decode16k(file));
  const { data, nPatches } = melPatches(pcm);
  const input = new ort.Tensor('float32', data, [nPatches, PATCH, MELS]);
  // bsdynamic ONNX export renamed the tensors: input 'melspectrogram', outputs 'activations'/'embeddings'
  const out = await session.run({ [session.inputNames[0]]: input });
  const emb = out.embeddings.data; // [nPatches * 1280]
  // Mean-pool patches into one vector, then L2-normalize so cosine = dot product
  const D = 1280;
  const mean = new Float32Array(D);
  for (let p = 0; p < nPatches; p++)
    for (let d = 0; d < D; d++) mean[d] += emb[p * D + d];
  let norm = 0;
  for (let d = 0; d < D; d++) { mean[d] /= nPatches; norm += mean[d] * mean[d]; }
  norm = Math.sqrt(norm);
  for (let d = 0; d < D; d++) mean[d] /= norm;
  return mean;
}

const cosine = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

(async () => {
  const session = await ort.InferenceSession.create(path.join(__dirname, 'discogs-effnet-bsdynamic-1.onnx'));

  // 4 tracks per genre, straight from the user's real folders
  const pick = (dir, n) => fs.readdirSync(path.join(DJ, dir))
    .filter((f) => f.endsWith('.mp3')).slice(0, n)
    .map((f) => ({ genre: dir, file: path.join(DJ, dir, f), name: f.replace(/\.mp3$/, '').slice(0, 40) }));
  const tracks = [...pick('Chinese-chill', 4), ...pick('kpop', 4), ...pick('whitegirl', 4)];

  const embeddings = [];
  for (const t of tracks) {
    const t0 = Date.now();
    embeddings.push(await trackEmbedding(session, t.file));
    console.log(`embedded (${Date.now() - t0}ms) [${t.genre}] ${t.name}`);
  }

  // Similarity matrix + within/cross genre means
  let within = [], cross = [];
  console.log('\nmost similar track for each (by embedding cosine):');
  for (let i = 0; i < tracks.length; i++) {
    let best = -1, bestSim = -2;
    for (let j = 0; j < tracks.length; j++) {
      if (i === j) continue;
      const sim = cosine(embeddings[i], embeddings[j]);
      (tracks[i].genre === tracks[j].genre ? within : cross).push(sim);
      if (sim > bestSim) { bestSim = sim; best = j; }
    }
    const hit = tracks[i].genre === tracks[best].genre ? '✓' : '✗';
    console.log(`  ${hit} [${tracks[i].genre}] ${tracks[i].name}`);
    console.log(`      → ${bestSim.toFixed(3)} [${tracks[best].genre}] ${tracks[best].name}`);
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  console.log(`\nwithin-genre mean cosine: ${mean(within).toFixed(3)}  (${within.length / 2} pairs)`);
  console.log(`cross-genre  mean cosine: ${mean(cross).toFixed(3)}  (${cross.length / 2} pairs)`);
  console.log(`separation: ${(mean(within) - mean(cross)).toFixed(3)}  → ${mean(within) - mean(cross) > 0.05 ? 'PASS' : 'WEAK'}`);
})();
