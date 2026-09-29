import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureClockProblem,
  planAsrSegments,
  skipRecognizedAudio,
} from '../extension/core/asr-progress.js';

test('ASR plans a ten-second first segment and rolling one-minute segments only after the playhead', () => {
  const plan = planAsrSegments(7200, 7505);
  assert.deepEqual(
    plan.map(({ start, end, status }) => [start, end, status]),
    [
      [7200, 7210, 'pending'],
      [7210, 7270, 'pending'],
      [7270, 7330, 'pending'],
      [7330, 7390, 'pending'],
      [7390, 7450, 'pending'],
      [7450, 7505, 'pending'],
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

test('delayed player messages and brief buffering do not falsely interrupt capture', () => {
  const session = { startedAt: 1000 };
  assert.deepEqual(
    captureClockProblem(session, { time: 199, sampleAt: 900, readyState: 4 }),
    { stale: true, reason: '' },
  );
  assert.equal(captureClockProblem(session, { time: 200, sampleAt: 1000, readyState: 4 }).reason, '');
  assert.equal(captureClockProblem(session, { time: 201, sampleAt: 2000, readyState: 4 }, 9000).reason, '');
  assert.deepEqual(
    captureClockProblem(session, { time: 200.5, sampleAt: 1500, readyState: 4 }),
    { stale: true, reason: '' },
  );
  assert.equal(captureClockProblem(session, { time: 201.2, sampleAt: 3000, readyState: 1 }).reason, '');
  assert.equal(captureClockProblem(session, { time: 201.2, sampleAt: 3800, readyState: 4 }).reason, '');
});

test('sustained stalled playback interrupts capture before timestamps become unreliable', () => {
  const session = {};
  captureClockProblem(session, { time: 100, sampleAt: 1000, readyState: 4 });
  assert.equal(captureClockProblem(session, { time: 101, sampleAt: 2000, readyState: 1 }).reason, '');
  assert.equal(captureClockProblem(session, { time: 101, sampleAt: 3500, readyState: 1 }).reason, '');
  assert.match(
    captureClockProblem(session, { time: 101, sampleAt: 5100, readyState: 1 }).reason,
    /持续缓冲/,
  );
  const jumped = {};
  captureClockProblem(jumped, { time: 100, sampleAt: 1000, readyState: 4 });
  assert.equal(captureClockProblem(jumped, { time: 106, sampleAt: 2000, readyState: 4 }).reason, '');
  assert.match(
    captureClockProblem(jumped, { time: 107.6, sampleAt: 3600, readyState: 4 }).reason,
    /持续不同步/,
  );
});
