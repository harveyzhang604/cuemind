export const SCHEMA_VERSION = 2;
export function videoKey(v) {
  return `${v.platform}:${v.videoId}:${v.page || 1}`;
}
export function normalizeCaptions(items, source = 'import') {
  if (!Array.isArray(items)) throw new Error('字幕列表格式无效');
  items = items.filter((x) => x && typeof x === 'object');
  const result = items
    .map((x, i) => ({
      id: `raw-${i}`,
      start: Number(x.start ?? x.from),
      end: Number(x.end ?? x.to),
      text: String(x.text ?? x.content ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
      source,
    }))
    .filter(
      (x) =>
        x.text &&
        Number.isFinite(x.start) &&
        Number.isFinite(x.end) &&
        x.start >= 0 &&
        x.end > x.start,
    )
    .sort((a, b) => a.start - b.start);
  return result.map((x, i) => ({ ...x, id: `raw-${i}` }));
}
// Some providers put several spoken sentences in one timed cue. Split its text
// for reading and replay while retaining the provider's outer time interval.
// Interior boundaries are proportional estimates because no finer timing exists.
export function splitTimedCaptions(raw) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  const pieces = [];
  for (const cue of raw) {
    // Some ASR providers omit the space after a full stop. Segmenter then
    // treats several spoken sentences as one cue ("great.And ...").
    const spaced = cue.text.replace(/\.([A-Z][a-z])/g, (match, next, offset, text) => {
      const word = text
        .slice(0, offset)
        .match(/([A-Za-z]+)$/)?.[1]
        ?.toLowerCase();
      return ['mr', 'mrs', 'ms', 'dr', 'prof', 'st'].includes(word) ? match : `. ${next}`;
    });
    const parts = [...segmenter.segment(spaced)].map((x) => x.segment.trim()).filter(Boolean);
    const duration = cue.end - cue.start;
    if (parts.length < 2 || duration < parts.length * 0.35) {
      pieces.push(cue);
      continue;
    }
    const weights = parts.map((x) => Math.max(1, x.length));
    const total = weights.reduce((a, b) => a + b, 0);
    let used = 0;
    for (let i = 0; i < parts.length; i++) {
      const start = cue.start + (duration * used) / total;
      used += weights[i];
      const end = i === parts.length - 1 ? cue.end : cue.start + (duration * used) / total;
      pieces.push({
        ...cue,
        start,
        end,
        text: parts[i],
        sourceRawId: cue.sourceRawId || cue.id,
        estimatedTiming: true,
      });
    }
  }
  return pieces.map((cue, i) => ({ ...cue, id: `raw-${i}` }));
}
// Unlike splitTimedCaptions, retain existing cue IDs. Live ASR appends new
// chunks over time, so renumbering earlier cues would break sentence/notes
// references and backup provenance.
export function splitAsrCaptions(raw) {
  return raw.flatMap((cue) => {
    const parts = splitTimedCaptions([cue]);
    if (parts.length < 2) return [cue];
    return parts.map((part, index) => ({
      ...part,
      id: index ? `${cue.id}:part:${index}` : cue.id,
    }));
  });
}
export function joinText(items) {
  return items
    .map((x) => x.text)
    .join(' ')
    .replace(/([\p{Script=Han}]) (?=[\p{Script=Han}])/gu, '$1')
    .replace(/\s+([,.;!?，。；！？、])/g, '$1');
}
export function parseJSON3(data) {
  const items = [];
  for (const e of data.events || []) {
    if (!e.segs || !Number.isFinite(e.tStartMs)) continue;
    const segs = e.segs.filter((s) => s.utf8?.trim());
    if (segs.length > 1 && !segs.some((s) => Number.isFinite(s.tOffsetMs) && s.tOffsetMs > 0)) {
      items.push({
        start: e.tStartMs / 1000,
        end: (e.tStartMs + (e.dDurationMs || 2000)) / 1000,
        text: segs.map((s) => s.utf8).join(''),
      });
      continue;
    }
    for (let i = 0; i < segs.length; i++) {
      const start = (e.tStartMs + (segs[i].tOffsetMs || 0)) / 1000;
      const end =
        i + 1 < segs.length
          ? (e.tStartMs + (segs[i + 1].tOffsetMs || 0)) / 1000
          : (e.tStartMs + (e.dDurationMs || 2000)) / 1000;
      items.push({ start, end: Math.max(start + 0.02, end), text: segs[i].utf8 });
    }
  }
  return splitTimedCaptions(normalizeCaptions(items, 'youtube_native'));
}
export function parseSubtitle(text) {
  const time = (x) =>
    x
      .replace(',', '.')
      .split(':')
      .reduce((a, b) => a * 60 + Number(b), 0);
  const items = [];
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(
      /((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/,
    );
    if (!m) continue;
    const body = [];
    while (++i < lines.length && lines[i].trim()) body.push(lines[i]);
    items.push({
      start: time(m[1]),
      end: time(m[2]),
      text: body.join(' ').replace(/<[^>]*>/g, ''),
    });
  }
  const raw = normalizeCaptions(items);
  if (!raw.length) throw new Error('未找到带时间戳的字幕，请选择 SRT 或 WebVTT 文件。');
  return raw;
}
export function formatTime(s = 0) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return `${h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
export function timestampUrl(v, t) {
  try {
    const u = new URL(v.url);
    if (!['https:', 'http:'].includes(u.protocol)) return '';
    u.searchParams.set('t', String(Math.floor(t)));
    return u.href;
  } catch {
    return '';
  }
}

// Alternate ASR passes can disagree in wording while describing the same audio.
// Require strongly overlapping timing and similar wording; never dedupe by the
// displayed whole-second timestamp alone.
export function deduplicateAsrCaptions(raw, preferredIds = new Set()) {
  const kept = [],
    removed = [];
  const words = (text) =>
    new Set(
      String(text || '')
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) || [],
    );
  for (const cue of [...raw].sort(
    (a, b) => Number(preferredIds.has(b.id)) - Number(preferredIds.has(a.id)) || a.start - b.start,
  )) {
    const tokens = words(cue.text);
    const duplicate = kept.findLast((old) => {
      const overlap = Math.min(old.end, cue.end) - Math.max(old.start, cue.start);
      const shortest = Math.min(old.end - old.start, cue.end - cue.start);
      if (shortest <= 0 || overlap / shortest < 0.75 || Math.abs(old.start - cue.start) > 0.8)
        return false;
      const previous = words(old.text);
      const shared = [...tokens].filter((word) => previous.has(word)).length;
      const similarity = shared / Math.max(tokens.size, previous.size, 1);
      const sameInterval =
        Math.abs(old.start - cue.start) <= 0.5 &&
        Math.abs(old.end - cue.end) <= 0.5 &&
        shortest >= 1;
      return similarity >= 0.6 || (sameInterval && shared >= 3 && similarity >= 0.25);
    });
    if (duplicate) removed.push(cue);
    else kept.push(cue);
  }
  kept.sort((a, b) => a.start - b.start);
  return { kept, removed };
}
