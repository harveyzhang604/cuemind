import { deduplicateAsrCaptions } from '../extension/core/transcript.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAsrTimeline,
  captureClockProblem,
  planAsrSegments,
  skipRecognizedAudio,
  visibleAsrTimeline,
} from '../extension/core/asr-progress.js';

test('progress hides a sub-second pending boundary that renders as the same timestamp', () => {
  const timeline = buildAsrTimeline(100, [
    { id: 'first', start: 0, end: 84.2, status: 'done' },
    { id: 'second', start: 84.7, end: 100, status: 'done' },
  ]);
  assert.ok(timeline.some((segment) => segment.status === 'pending' && segment.start === 84.2));
  assert.ok(
    !visibleAsrTimeline(timeline).some(
      (segment) => segment.status === 'pending' && segment.start === 84.2,
    ),
  );
});

test('ASR progress covers the whole video and retains earlier session results', () => {
  const timeline = buildAsrTimeline(
    240,
    [
      { id: 'earlier', sessionId: 'old', start: 30, end: 90, status: 'done' },
      { id: 'old-failure', sessionId: 'old', start: 90, end: 120, status: 'failed' },
      { id: 'later', sessionId: 'new', start: 130, end: 140, status: 'no-speech' },
      { id: 'retry', sessionId: 'new', start: 30, end: 90, status: 'pending' },
      { id: 'future', sessionId: 'new', start: 140, end: 200, status: 'pending' },
    ],
    'new',
  );
  assert.equal(timeline[0].start, 0);
  assert.equal(timeline.at(-1).end, 240);
  assert.deepEqual(
    timeline.filter((segment) => segment.status === 'done').map(({ start, end }) => [start, end]),
    [[30, 90]],
  );
  assert.deepEqual(
    timeline
      .filter((segment) => segment.status === 'no-speech')
      .map(({ start, end }) => [start, end]),
    [[130, 140]],
  );
  assert.equal(timeline.find((segment) => segment.start === 90).status, 'failed');
  assert.equal(timeline.find((segment) => segment.start === 0).status, 'pending');
  assert.ok(timeline.some((segment) => segment.start === 200 && segment.status === 'pending'));
  for (let index = 1; index < timeline.length; index += 1)
    assert.equal(timeline[index - 1].end, timeline[index].start);
});

test('a later successful retry replaces an old failure in the timeline', () => {
  const timeline = buildAsrTimeline(120, [
    { id: 'failed', start: 60, end: 80, status: 'failed' },
    { id: 'success', start: 60, end: 80, status: 'done' },
  ]);
  assert.equal(timeline.find((segment) => segment.start === 60).status, 'done');
  assert.ok(!timeline.some((segment) => segment.status === 'failed'));
});

test('legacy unplayed plans are shown as unstarted rather than failed', () => {
  const timeline = buildAsrTimeline(180, [
    { id: 'old-plan', start: 0, end: 60, status: 'interrupted', error: '上次识别已中断' },
    {
      id: 'tail',
      start: 60,
      end: 70,
      status: 'interrupted',
      error: '音频尚未播放，可从此位置继续',
    },
    { id: 'real-error', start: 70, end: 80, status: 'failed', error: 'ASR unavailable' },
    { id: 'saved', start: 80, end: 140, status: 'done' },
  ]);
  assert.ok(timeline.some((segment) => segment.start === 0 && segment.status === 'pending'));
  assert.ok(timeline.some((segment) => segment.start === 60 && segment.status === 'pending'));
  assert.equal(timeline.filter((segment) => segment.status === 'failed').length, 1);
  assert.ok(timeline.some((segment) => segment.start === 80 && segment.status === 'done'));
});

test('legacy provider no-words responses count as completed silence on resume', () => {
  const silent = {
    id: 'no-words',
    start: 10,
    end: 20,
    status: 'failed',
    error: 'HTTP 400: ASR_RESPONSE_HAVE_NO_WORDS',
  };
  const timeline = buildAsrTimeline(60, [silent]);
  assert.equal(timeline.find((segment) => segment.start === 10).status, 'no-speech');
  assert.ok(skipRecognizedAudio(11, [silent]) > 20);
});

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
  assert.deepEqual(captureClockProblem(session, { time: 199, sampleAt: 900, readyState: 4 }), {
    stale: true,
    reason: '',
  });
  assert.equal(
    captureClockProblem(session, { time: 200, sampleAt: 1000, readyState: 4 }).reason,
    '',
  );
  assert.equal(
    captureClockProblem(session, { time: 201, sampleAt: 2000, readyState: 4 }, 9000).reason,
    '',
  );
  assert.deepEqual(captureClockProblem(session, { time: 200.5, sampleAt: 1500, readyState: 4 }), {
    stale: true,
    reason: '',
  });
  assert.equal(
    captureClockProblem(session, { time: 201.2, sampleAt: 3000, readyState: 1 }).reason,
    '',
  );
  assert.equal(
    captureClockProblem(session, { time: 201.2, sampleAt: 3800, readyState: 4 }).reason,
    '',
  );
});

test('sustained stalled playback interrupts capture before timestamps become unreliable', () => {
  const session = {};
  captureClockProblem(session, { time: 100, sampleAt: 1000, readyState: 4 });
  assert.equal(
    captureClockProblem(session, { time: 101, sampleAt: 2000, readyState: 1 }).reason,
    '',
  );
  assert.equal(
    captureClockProblem(session, { time: 101, sampleAt: 3500, readyState: 1 }).reason,
    '',
  );
  assert.match(
    captureClockProblem(session, { time: 101, sampleAt: 5100, readyState: 1 }).reason,
    /持续缓冲/,
  );
  const jumped = {};
  captureClockProblem(jumped, { time: 100, sampleAt: 1000, readyState: 4 });
  assert.equal(
    captureClockProblem(jumped, { time: 106, sampleAt: 2000, readyState: 4 }).reason,
    '',
  );
  assert.match(
    captureClockProblem(jumped, { time: 107.6, sampleAt: 3600, readyState: 4 }).reason,
    /持续不同步/,
  );
});

test('ASR cleanup handles fractional timing and contained phrases, preserving unrelated speech', () => {
  const rows = [
    { id: 'a', start: 48.6, end: 49.34, text: 'Look at it.', estimatedTiming: true },
    { id: 'b', start: 48.87, end: 49.55, text: 'Look at it.', estimatedTiming: true },
    { id: 'c', start: 60, end: 68, text: 'Welcome to the arena for the championship tonight.' },
    { id: 'd', start: 63, end: 68.2, text: 'for the championship tonight.' },
    { id: 'e', start: 90, end: 91, text: 'Oh my goodness.' },
    { id: 'f', start: 91, end: 92, text: 'Oh my goodness.' },
  ];
  const result = deduplicateAsrCaptions(rows);
  assert.deepEqual(
    result.kept.map((r) => r.id),
    ['a', 'c', 'e', 'f'],
  );
  assert.equal(deduplicateAsrCaptions(result.kept).removed.length, 0);
});
test('different wording is consolidated only beside an established duplicate interval', () => {
  const rows = [
    { id: 'a', start: 50.35, end: 53.04, text: 'You gonna lost, you gonna lose me, bruh.' },
    {
      id: 'b',
      start: 50.75,
      end: 53.46,
      text: "You're gonna lock the off, they're gonna lead to me, Brad.",
    },
  ];
  assert.equal(deduplicateAsrCaptions(rows).removed.length, 0);
  assert.equal(deduplicateAsrCaptions(rows, new Set(), [{ start: 49, end: 50 }]).removed.length, 1);
});

test('ASR cleanup consolidates shifted prefixes and split variants with different names', () => {
  const rows = [
    {
      id: 'short',
      start: 227.52,
      end: 232,
      text: 'At stake under the lights, Joshua Vance, UFC flyweight title, a prize.',
    },
    {
      id: 'whole',
      start: 228.24,
      end: 237.81,
      text: "At stake under the lights, Joshua Van's UFC flyweight title, a prize former champion Alexandre Pantoja is obsessed with regaining.",
    },
    {
      id: 'tail',
      start: 232,
      end: 236.58,
      text: 'Former champion, Alisandre Pantoja, is obsessed with regaining.',
    },
    { id: 'prefix', start: 1830, end: 1830.8, text: 'Z przyruchu.' },
    { id: 'long', start: 1830.96, end: 1833.92, text: 'Z przyruchu, ale też on też się rusza.' },
  ];
  const result = deduplicateAsrCaptions(rows);
  assert.deepEqual(
    result.kept.map((r) => r.id),
    ['whole', 'long'],
  );
  assert.equal(deduplicateAsrCaptions(result.kept).removed.length, 0);
});
