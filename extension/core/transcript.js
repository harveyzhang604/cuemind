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

// Consolidate alternate transcriptions of overlapping audio, including a
// sentence returned once as a whole and once as several shorter captions.
export function deduplicateAsrCaptions(raw, preferredIds = new Set(), knownConflicts = []) {
  const kept = [],
    removed = [],
    conflicts = [...knownConflicts];
  const compact = (text) =>
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
  const words = (text) =>
    new Set(
      String(text || '')
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) || [],
    );
  const overlapOf = (a, b) => Math.min(a.end, b.end) - Math.max(a.start, b.start);
  const ordered = [...raw].sort(
    (a, b) =>
      Number(preferredIds.has(b.id)) - Number(preferredIds.has(a.id)) ||
      compact(b.text).length - compact(a.text).length ||
      a.start - b.start,
  );
  for (const cue of ordered) {
    const text = compact(cue.text),
      tokens = words(cue.text);
    const duplicate = kept.find((old) => {
      const overlap = overlapOf(old, cue);
      if (overlap <= 0) {
        // A second ASR pass can move a short prefix just outside the longer cue.
        const other = compact(old.text);
        return (
          overlap >= -0.25 &&
          Math.abs(old.start - cue.start) <= 1.1 &&
          Math.min(text.length, other.length) >= 8 &&
          text !== other &&
          (text.startsWith(other) || other.startsWith(text))
        );
      }
      const other = compact(old.text),
        previous = words(old.text);
      const shared = [...tokens].filter((word) => previous.has(word)).length;
      const ratio = overlap / Math.min(old.end - old.start, cue.end - cue.start);
      // Very short exclamations need close timing; repeated speech remains valid.
      if (text === other)
        return text.length >= 12
          ? ratio >= 0.1
          : ratio >= 0.5 && Math.abs(old.start - cue.start) < 0.8;
      if (
        Math.min(text.length, other.length) >= 15 &&
        (text.includes(other) || other.includes(text))
      )
        return ratio >= 0.1;
      // One pass emits a full sentence while another splits it, with names
      // spelled differently. Compare coverage of the shorter phrase in order.
      if (Math.min(tokens.size, previous.size) >= 6 && ratio >= 0.3) {
        const a =
          String(cue.text)
            .toLowerCase()
            .match(/[\p{L}\p{N}]+/gu) || [];
        const b =
          String(old.text)
            .toLowerCase()
            .match(/[\p{L}\p{N}]+/gu) || [];
        let row = new Array(b.length + 1).fill(0);
        for (const word of a) {
          const next = [0];
          for (let j = 0; j < b.length; j++)
            next.push(word === b[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]));
          row = next;
        }
        if (row[b.length] / Math.min(a.length, b.length) >= 0.8) return true;
      }
      if (
        Math.min(text.length, other.length) >= 8 &&
        ratio >= 0.6 &&
        Math.abs(old.start - cue.start) < 1.1 &&
        (text.startsWith(other) || other.startsWith(text))
      )
        return true;
      const shorterSize = Math.min(tokens.size, previous.size);
      if (
        ratio >= 0.6 &&
        Math.abs(old.start - cue.start) <= 3 &&
        ((shorterSize >= 4 && shared / shorterSize >= 0.75) ||
          (shared >= 6 && shared / shorterSize >= 0.7))
      )
        return true;
      const conflictTiming =
        ratio >= 0.1 &&
        conflicts.some(
          (area) =>
            Math.min(old.start, cue.start) >= area.start - 8 &&
            Math.max(old.end, cue.end) <= area.end + 8,
        );
      return (
        shared / Math.max(tokens.size, previous.size, 1) >= 0.6 &&
        (ratio >= 0.3 || conflictTiming) &&
        Math.abs(old.start - cue.start) <= 3
      );
    });
    if (duplicate) {
      removed.push(cue);
      conflicts.push({
        start: Math.min(cue.start, duplicate.start),
        end: Math.max(cue.end, duplicate.end),
      });
    } else kept.push(cue);
  }
  // Conflicting passes also disagree completely on an occasional short line.
  // Resolve only heavily overlapping lines adjacent to an established duplicate,
  // never arbitrary same-second captions elsewhere.
  const final = [];
  for (const cue of kept) {
    const duplicate = final.find((old) => {
      const overlap = overlapOf(old, cue);
      const shiftedCopy =
        overlap > -0.5 &&
        Math.abs(old.start - cue.start) < 2.5 &&
        (old.estimatedTiming || cue.estimatedTiming) &&
        (!old.sourceRawId || old.sourceRawId !== cue.sourceRawId) &&
        compact(old.text).length >= 12 &&
        compact(old.text) === compact(cue.text) &&
        conflicts.some(
          (area) =>
            Math.min(old.start, cue.start) >= area.start - 8 &&
            Math.max(old.end, cue.end) <= area.end + 8,
        );
      if (shiftedCopy) return true;
      const ratio = overlap / Math.min(old.end - old.start, cue.end - cue.start);
      const timingMatch =
        (ratio >= 0.55 && Math.abs(old.start - cue.start) < 0.8) ||
        (ratio >= 0.65 && Math.abs(old.start - cue.start) < 2);
      if (!timingMatch) return false;
      const a = words(old.text),
        b = words(cue.text);
      const shared = [...a].filter((word) => b.has(word)).length;
      return (
        timingMatch &&
        shared >= 3 &&
        shared / Math.max(a.size, b.size, 1) >= 0.25 &&
        conflicts.some(
          (area) =>
            Math.min(old.start, cue.start) >= area.start - 4 &&
            Math.max(old.end, cue.end) <= area.end + 4,
        )
      );
    });
    if (duplicate) removed.push(cue);
    else final.push(cue);
  }
  final.sort((a, b) => a.start - b.start);
  return { kept: final, removed };
}
