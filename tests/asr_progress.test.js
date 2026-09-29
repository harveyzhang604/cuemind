import test from 'node:test';
import assert from 'node:assert/strict';
import { planAsrSegments, skipRecognizedAudio } from '../extension/core/asr-progress.js';

test('ASR plans a short first segment and rolling one-minute segments only after the playhead', () => {
  const plan = planAsrSegments(7200, 7505);
  assert.deepEqual(
    plan.map(({ start, end, status }) => [start, end, status]),
    [
      [7200, 7220, 'pending'],
      [7220, 7280, 'pending'],
      [7280, 7340, 'pending'],
      [7340, 7400, 'pending'],
      [7400, 7460, 'pending'],
      [7460, 7505, 'pending'],
    ],
  );
  assert.deepEqual(planAsrSegments(99, 100), []);
  assert.equal(planAsrSegments(0, 3600).at(-1).end, 3600);
});

test('ASR resumes after contiguous successful audio but never skips a failed gap', () => {
  const segments = [
    { start: 10, end: 40, status: 'done' },
    { start: 40.2, end: 160, status: 'translation-failed' },
    { start: 160, end: 280, status: 'failed' },
    { start: 280, end: 400, status: 'done' },
    { start: 400.2, end: 430, status: 'no-speech' },
  ];
  assert.ok(skipRecognizedAudio(11, segments) > 160);
  assert.equal(skipRecognizedAudio(200, segments), 200);
  assert.ok(skipRecognizedAudio(300, segments) > 430);
  assert.equal(skipRecognizedAudio(5, segments), 5);
});
