import test from 'node:test';
import assert from 'node:assert/strict';
import { audioCoverage } from '../extension/storage/audio.js';
import { clipAt, coversRange } from '../extension/panel/local-audio.js';

const clips = [
  { id: 'a', start: 0, end: 10, bytes: 100 },
  { id: 'b', start: 10, end: 20, bytes: 200 },
  { id: 'c', start: 25, end: 30, bytes: 50 },
];

test('local audio coverage merges adjacent chunks and reports storage', () => {
  assert.deepEqual(audioCoverage(clips), {
    seconds: 25,
    bytes: 350,
    ranges: [
      { start: 0, end: 20 },
      { start: 25, end: 30 },
    ],
  });
});

test('local audio playback only claims ranges that have saved chunks', () => {
  assert.equal(clipAt(clips, 5).id, 'a');
  assert.equal(clipAt(clips, 20), undefined);
  assert.equal(coversRange(clips, 2, 19), true);
  assert.equal(coversRange(clips, 2, 26), false);
});
