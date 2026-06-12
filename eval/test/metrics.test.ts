/**
 * Tests for the metric computation (evaluateTopN) on a hand-built fixture
 * where the right answer is known by construction.
 *
 * Run: node --test eval/test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { scorePair } from '../../app/src/shared/scoring.ts'
import { evaluateTopN, pairKey, mulberry32, type EvalTrack, type LabelValue } from '../lib.ts'

let nextId = 1
function track(over: Partial<EvalTrack>): EvalTrack {
  const id = nextId++
  return {
    id, path: `/t/${id}.mp3`, filename: `${id}.mp3`, title: `T${id}`, artist: 'A', durationS: 200,
    bpm: null, camelot: null, energyDb: null, embedding: new Float32Array([1, 0]), ...over,
  }
}

function rankedEntry(query: EvalTrack, t: EvalTrack) {
  return { track: t, ...scorePair(query, t) }
}

test('evaluateTopN: precision counts only labeled pairs, harmonic/BPM count everything', () => {
  const query = track({ bpm: 120, camelot: '8A' })
  const mixHit = track({ bpm: 121, camelot: '8A' })   // labeled mix, harmonic, in range
  const noHit = track({ bpm: 150, camelot: '2B' })    // labeled no, clash, out of range
  const unlabeled = track({ bpm: 240, camelot: '9A' }) // no label; harmonic; 2x = in range
  const skipped = track({ bpm: 121, camelot: '3B' })  // skip = excluded from precision

  const labels = new Map<string, LabelValue>([
    [pairKey(query.path, mixHit.path), 'mix'],
    [pairKey(query.path, noHit.path), 'no'],
    [pairKey(query.path, skipped.path), 'skip'],
  ])

  const ev = evaluateTopN(query, [mixHit, noHit, unlabeled, skipped].map((t) => rankedEntry(query, t)), labels)

  assert.equal(ev.n, 4)
  assert.equal(ev.labeledTotal, 2)      // mix + no; skip and unlabeled excluded
  assert.equal(ev.labeledMix, 1)        // precision@N numerator
  assert.equal(ev.harmonicCount, 2)     // 8A→8A and 8A→9A
  assert.equal(ev.bpmInRangeCount, 3)   // 121 (1x), 240 (2x), 121 — not 150
})

test('evaluateTopN: empty top-N produces zeros, not NaN', () => {
  const query = track({ camelot: '8A' })
  const ev = evaluateTopN(query, [], new Map())
  assert.deepEqual(ev, { n: 0, labeledTotal: 0, labeledMix: 0, harmonicCount: 0, bpmInRangeCount: 0 })
})

test('mulberry32 is deterministic and in [0, 1)', () => {
  const a = mulberry32(42)
  const b = mulberry32(42)
  for (let i = 0; i < 100; i++) {
    const x = a()
    assert.equal(x, b())
    assert.ok(x >= 0 && x < 1)
  }
})
