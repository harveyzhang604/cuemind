export const FIRST_ASR_SECONDS = 30;
export const NEXT_ASR_SECONDS = 120;

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
