/**
 * Tests for the shared scoring module — the parity guard for the
 * extract-from-similar.ts refactor. These pin the exact numeric behavior
 * the app had before extraction; if a future edit changes any of these,
 * the eval numbers stop being comparable to old runs.
 *
 * Run: node --test eval/test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WEIGHTS, identityKey, bpmScore, keyScore, energyScore, cosine, scorePair, rankCandidates,
  type ScorableTrack,
} from '../../app/src/shared/scoring.ts'

// tiny helper: a track with a hand-set embedding (any length works — cosine
// only assumes L2-normalized vectors)
function track(over: Partial<ScorableTrack> & { embedding: Float32Array }): ScorableTrack {
  return { filename: 'x.mp3', title: null, artist: null, bpm: null, camelot: null, energyDb: null, ...over }
}

test('WEIGHTS sum to 1 (scores stay in 0..1)', () => {
  const sum = WEIGHTS.style + WEIGHTS.bpm + WEIGHTS.key + WEIGHTS.energy
  assert.ok(Math.abs(sum - 1) < 1e-9)
})

test('bpmScore: identical tempo = 1, 8% apart = 0, beyond = 0', () => {
  assert.equal(bpmScore(120, 120).score, 1)
  // the 8% window is relative to the CANDIDATE's bpm (rel = |a·mult − b| / b),
  // so 108 vs 100 is exactly 8% → 0; pinning this asymmetry on purpose
  assert.equal(bpmScore(108, 100).score, 0)
  assert.equal(bpmScore(120, 200).score, 0)
})

test('bpmScore: half/double-time counts as the same groove', () => {
  const half = bpmScore(140, 70) // query at 140, candidate at 70
  assert.equal(half.score, 1)
  assert.equal(half.shownMult, 0.5)
  const dbl = bpmScore(70, 140)
  assert.equal(dbl.score, 1)
  assert.equal(dbl.shownMult, 2)
})

test('bpmScore: unknown BPM is neutral (0.5), not incompatible', () => {
  assert.equal(bpmScore(null, 120).score, 0.5)
  assert.equal(bpmScore(120, null).score, 0.5)
})

test('keyScore: same key 1, Camelot-compatible 0.85, clash 0, unknown 0.5', () => {
  assert.equal(keyScore('8A', '8A'), 1)
  assert.equal(keyScore('8A', '8B'), 0.85)  // relative major/minor
  assert.equal(keyScore('8A', '9A'), 0.85)  // wheel neighbor, same ring
  assert.equal(keyScore('8A', '2B'), 0)     // far across the wheel
  assert.equal(keyScore(null, '8A'), 0.5)
})

test('energyScore: equal = 1, 6 dB apart = 0, unknown neutral', () => {
  assert.equal(energyScore(-10, -10), 1)
  assert.equal(energyScore(-10, -16), 0)
  assert.equal(energyScore(null, -10), 0.5)
})

test('identityKey strips downloader junk, brackets, case, punctuation', () => {
  const a = identityKey({ artist: 'IU', title: 'Blueming (SPOTISAVER)', filename: 'a.mp3' })
  const b = identityKey({ artist: 'iu', title: 'Blueming [NotSlider.nl]', filename: 'b.mp3' })
  assert.equal(a, b)
  assert.equal(a, 'iu blueming')
})

test('identityKey keeps non-Latin scripts (CJK library!)', () => {
  const k = identityKey({ artist: '周杰伦', title: '七里香', filename: 'x.mp3' })
  assert.equal(k, '周杰伦 七里香')
})

test('scorePair blends with WEIGHTS exactly', () => {
  const e = new Float32Array([1, 0])
  const q = track({ embedding: e, bpm: 120, camelot: '8A', energyDb: -10 })
  const c = track({ embedding: e, bpm: 120, camelot: '8A', energyDb: -10 })
  // identical everything → every part 1 → score exactly 1
  const s = scorePair(q, c)
  assert.deepEqual(s.parts, { style: 1, bpm: 1, key: 1, energy: 1 })
  assert.ok(Math.abs(s.score - 1) < 1e-9)
})

test('rankCandidates: orders by score and never suggests the same song back', () => {
  const e = new Float32Array([1, 0])
  const q = track({ embedding: e, artist: 'IU', title: 'Blueming', bpm: 120, camelot: '8A', energyDb: -10 })
  const dupOfQuery = track({ embedding: e, artist: 'IU', title: 'Blueming (copy)', bpm: 120, camelot: '8A', energyDb: -10 })
  const good = track({ embedding: e, artist: 'A', title: 'Good', bpm: 121, camelot: '8A', energyDb: -10 })
  const far = track({ embedding: new Float32Array([0, 1]), artist: 'B', title: 'Far', bpm: 90, camelot: '2B', energyDb: -20 })

  const ranked = rankCandidates(q, [far, dupOfQuery, good])
  // the duplicate of the query is gone even though it scores a perfect 1
  assert.deepEqual(ranked.map((r) => r.track.title), ['Good', 'Far'])
  assert.ok(ranked[0].score > ranked[1].score)
})

test('rankCandidates: same-song variants dedupe keeping the best, topN respected', () => {
  const e = new Float32Array([1, 0])
  const q = track({ embedding: e, artist: 'Q', title: 'Query', bpm: 120, camelot: '8A', energyDb: -10 })
  const v1 = track({ embedding: e, artist: 'A', title: 'Song', bpm: 120, camelot: '8A', energyDb: -10 })
  const v2 = track({ embedding: e, artist: 'A', title: 'Song [NotSlider.nl]', bpm: 124, camelot: '8A', energyDb: -10 })
  const other = track({ embedding: e, artist: 'B', title: 'Other', bpm: 122, camelot: '9A', energyDb: -11 })

  const ranked = rankCandidates(q, [v2, v1, other], WEIGHTS, 5)
  const titles = ranked.map((r) => r.track.title)
  assert.equal(titles.filter((t) => t?.startsWith('Song')).length, 1) // one variant only
  assert.equal(titles[0], 'Song') // the better-scoring variant (exact BPM) won
  assert.equal(ranked.length, 2)
})
