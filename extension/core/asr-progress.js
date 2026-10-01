export const FIRST_ASR_SECONDS = 10;
export const NEXT_ASR_SECONDS = 60;

const isLegacyNoSpeech = (segment) =>
  segment?.status === 'failed' && /ASR_RESPONSE_HAVE_NO_WORDS/.test(segment.error || '');

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

// The recorder only plans after the playhead. The progress view is different:
// it must cover the whole video and combine results from every saved session.
export function buildAsrTimeline(duration, savedSegments = [], currentSessionId = null) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const priority = {
    done: 100,
    translating: 90,
    'source-ready': 80,
    'translation-failed': 75,
    'no-speech': 70,
    recognizing: 60,
    queued: 55,
    capturing: 50,
    failed: 40,
    interrupted: 30,
    pending: 0,
  };
  const rows = (Array.isArray(savedSegments) ? savedSegments : [])
    .filter(
      (segment) =>
        segment &&
        !(
          segment.status === 'interrupted' &&
          ['上次识别已中断', '音频尚未播放，可从此位置继续'].includes(segment.error) &&
          !segment.audioBytes &&
          !segment.queuedAt &&
          !segment.recognizingAt
        ) &&
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end > segment.start &&
        segment.end > 0 &&
        segment.start < duration &&
        Object.hasOwn(priority, segment.status) &&
        (segment.status !== 'pending' ||
          !currentSessionId ||
          segment.sessionId === currentSessionId),
    )
    .map((segment, index) => ({
      ...segment,
      // Earlier versions stored the provider's explicit "no words" result as
      // a failure. It is a completed silent interval, including on resume.
      status: isLegacyNoSpeech(segment) ? 'no-speech' : segment.status,
      error: isLegacyNoSpeech(segment) ? '' : segment.error,
      start: Math.max(0, segment.start),
      end: Math.min(duration, segment.end),
      order: index,
    }));
  const points = new Set([0, duration]);
  for (let tick = NEXT_ASR_SECONDS; tick < duration; tick += NEXT_ASR_SECONDS) points.add(tick);
  for (const segment of rows) {
    points.add(segment.start);
    points.add(segment.end);
  }
  const sorted = [...points].sort((a, b) => a - b);
  const timeline = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    if (end - start < 0.01) continue;
    const owner = rows
      .filter((segment) => segment.start <= start + 0.01 && segment.end >= end - 0.01)
      .sort((a, b) => priority[b.status] - priority[a.status] || b.order - a.order)[0];
    const segment = owner || { status: 'pending' };
    const previous = timeline.at(-1);
    // Keep saved capture boundaries intact, including across a minute tick.
    if (owner && previous?.id === owner.id && previous.status === owner.status) {
      previous.end = end;
    } else {
      timeline.push({
        ...segment,
        id: owner?.id || `unstarted-${start}`,
        start,
        end,
      });
    }
  }
  // The player displays whole seconds, while capture metadata may retain
  // fractions. Do not offer an unrecordable "end–end" retry after a completed
  // final interval. Keep real failures and gaps elsewhere in the video.
  const lastRecognized = timeline.findLastIndex((segment) => hasOriginal(segment));
  if (lastRecognized >= 0 && lastRecognized < timeline.length - 1) {
    const completedEnd = timeline[lastRecognized].end;
    if (
      Math.floor(completedEnd) === Math.floor(duration) &&
      timeline.slice(lastRecognized + 1).every((segment) => segment.status === 'pending')
    )
      timeline.splice(lastRecognized + 1);
  }
  return timeline;
}

const hasOriginal = (segment) =>
  ['source-ready', 'translating', 'done', 'translation-failed', 'no-speech'].includes(
    segment?.status,
  ) || isLegacyNoSpeech(segment);

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
