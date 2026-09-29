export const FIRST_ASR_SECONDS = 10;
export const NEXT_ASR_SECONDS = 60;

// Compare timestamps sampled in the video tab, not when the service worker
// happens to receive them. A delayed message must not look like a video jump.
export function captureClockProblem(session, tick, receivedAt = Date.now()) {
  const clock = Number.isFinite(tick.sampleAt) ? tick.sampleAt : receivedAt;
  if (Number.isFinite(session.startedAt) && clock < session.startedAt)
    return { stale: true, reason: '' };
  if (session.lastTick && clock <= session.lastTick.clock) return { stale: true, reason: '' };
  session.lastTick = { time: tick.time, clock };
  if (!Number.isFinite(tick.time)) return { stale: false, reason: '播放器时间不可用' };
  if (!session.mediaAnchor) session.mediaAnchor = { time: tick.time, clock };
  if (tick.readyState < 2) {
    session.bufferSince ??= clock;
    if (clock - session.bufferSince >= 3000)
      return { stale: false, reason: '视频持续缓冲超过 3 秒' };
  } else {
    session.bufferSince = null;
  }
  const expected = session.mediaAnchor.time + (clock - session.mediaAnchor.clock) / 1000;
  if (Math.abs(tick.time - expected) > 2.5) {
    session.driftSince ??= clock;
    if (clock - session.driftSince >= 1500)
      return { stale: false, reason: '播放时间与录音持续不同步' };
  } else {
    session.driftSince = null;
  }
  return { stale: false, reason: '' };
}

// Only plan audio after the current playhead. Nothing before it is requested
// from the speech service unless the user deliberately seeks back there.
export function planAsrSegments(start, duration, makeId = (index) => `asr-${index}`) {
  if (!Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration - start < 2)
    return [];
  const plan = [];
  let cursor = start;
  while (cursor < duration - 0.2 && plan.length < 2000) {
    const length = plan.length ? NEXT_ASR_SECONDS : FIRST_ASR_SECONDS;
    let end = Math.min(duration, cursor + length);
    if (duration - end < 5) end = duration;
    plan.push({ id: makeId(plan.length), start: cursor, end, status: 'pending' });
    cursor = end;
  }
  return plan;
}

const hasOriginal = (segment) =>
  ['source-ready', 'translating', 'done', 'translation-failed', 'no-speech'].includes(
    segment?.status,
  );

// A failed ASR segment is a gap, even if a later segment completed. Never
// jump over that gap when the user asks to continue from its time range.
export function skipRecognizedAudio(time, segments) {
  let next = time;
  const rows = (Array.isArray(segments) ? segments : [])
    .filter((segment) => hasOriginal(segment) && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);
  for (const segment of rows) {
    if (next < segment.start - 0.5) break;
    if (next < segment.end - 0.25 && next >= segment.start - 0.5) next = segment.end + 0.2;
  }
  return next;
}
