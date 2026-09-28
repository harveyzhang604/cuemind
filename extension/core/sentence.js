import { joinText } from './transcript.js';
const median = (xs) => {
  const a = [...xs].sort((a, b) => a - b);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};
function sentence(raw, from, to, source = 'rule') {
  const items = raw.slice(from, to + 1);
  return {
    id: `sent-${items[0].id}`,
    start: items[0].start,
    end: Math.max(...items.map((x) => x.end)),
    sourceIds: items.map((x) => x.id),
    rawText: joinText(items),
    boundarySource: source,
    estimatedTiming: items.some((x) => x.estimatedTiming),
  };
}
export function localSentences(raw) {
  if (!raw.length) return [];
  const gaps = raw.slice(1).map((r, i) => Math.max(0, r.start - raw[i].end));
  const mid = median(gaps),
    mad = median(gaps.map((x) => Math.abs(x - mid)));
  const pause = Math.max(0.65, mid + 3 * Math.max(mad, 0.12));
  const out = [];
  let from = 0,
    chars = 0;
  for (let i = 0; i < raw.length; i++) {
    chars += raw[i].text.length;
    const text = raw[i].text;
    const terminal =
      /[。！？!?][”’"')\]]*$/.test(text) ||
      (/[.][”’"')\]]*$/.test(text) && !/\b(?:Mr|Mrs|Dr|Prof|vs|etc|e\.g|i\.e|[A-Z])\.$/.test(text));
    const gap = raw[i + 1] ? raw[i + 1].start - raw[i].end : Infinity;
    const duration = raw[i].end - raw[from].start;
    if (
      i === raw.length - 1 ||
      terminal ||
      (gap >= pause && duration >= 1.5) ||
      duration >= 24 ||
      chars >= 320
    ) {
      out.push(sentence(raw, from, i));
      from = i + 1;
      chars = 0;
    }
  }
  return out;
}
export function boundarySentences(raw, boundaries) {
  if (!Array.isArray(boundaries) || !boundaries.length) throw new Error('断句边界为空');
  const ids = new Map(raw.map((x, i) => [x.id, i]));
  let prev = -1;
  const out = [];
  for (const b of boundaries) {
    const end = ids.get(b?.endId);
    if (end === undefined || end <= prev) throw new Error('断句 ID 越界或重复');
    out.push(sentence(raw, prev + 1, end, 'ai'));
    prev = end;
  }
  if (prev !== raw.length - 1) throw new Error('断句遗漏尾部');
  return out;
}
export function paragraphs(sentences) {
  const out = [];
  let group = [];
  const push = () => {
    if (!group.length) return;
    const p = {
      id: `para-${group[0].id}`,
      sentenceIds: group.map((s) => s.id),
      start: group[0].start,
      end: Math.max(...group.map((s) => s.end)),
    };
    out.push(p);
    for (const s of group) s.paragraphId = p.id;
    group = [];
  };
  for (const s of sentences) {
    if (
      group.length &&
      (s.end - group[0].start > 60 || s.start - group.at(-1).end > 3 || group.length >= 8)
    )
      push();
    group.push(s);
    if (group.length >= 3 && s.end - group[0].start >= 25) push();
  }
  push();
  return out;
}
export function activeIndex(sentences, time) {
  let lo = 0,
    hi = sentences.length - 1,
    best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sentences[mid].start <= time) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best >= 0 && time < sentences[best].end ? best : -1;
}
export function overlayTranslationIds(
  sentences,
  time,
  { horizon = 90, maxItems = 24, maxChars = 1400 } = {},
) {
  if (!sentences?.length) return [];
  const at = Math.max(
    0,
    sentences.findLastIndex((s) => s.start <= time),
  );
  const nearby = sentences.slice(Math.max(0, at - 1)).filter((s) => s.start <= time + horizon);
  const ids = [];
  let chars = 0;
  for (const s of nearby) {
    if (s.translation) continue;
    if (ids.length >= maxItems || (ids.length && chars + s.rawText.length > maxChars)) break;
    ids.push(s.id);
    chars += s.rawText.length;
  }
  return ids;
}
export function batches(items, maxChars = 6500, overlap = 0) {
  const result = [];
  let start = 0;
  while (start < items.length) {
    let end = start,
      size = 0;
    while (end < items.length && (size < maxChars || end === start)) {
      size += (items[end].rawText || items[end].text || '').length + 80;
      end++;
    }
    result.push(items.slice(start, end));
    if (end === items.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return result;
}
export function alignTranslations(sentences, items) {
  const map = new Map();
  const valid = new Set(sentences.map((s) => s.id));
  for (const x of Array.isArray(items) ? items : [])
    if (x && valid.has(x.id) && typeof x.text === 'string' && x.text.trim() && !map.has(x.id))
      map.set(x.id, x.text.trim());
  return sentences.map((s) => (map.has(s.id) ? { ...s, translation: map.get(s.id) } : s));
}
export function anchoredRanges(sentences, ranges) {
  const ids = new Map(sentences.map((s, i) => [s.id, i]));
  return (Array.isArray(ranges) ? ranges : []).flatMap((r) => {
    const a = ids.get(r?.fromSentenceId),
      b = ids.get(r?.toSentenceId);
    if (a === undefined || b === undefined || b < a) return [];
    return [
      {
        ...r,
        start: sentences[a].start,
        end: Math.max(...sentences.slice(a, b + 1).map((s) => s.end)),
      },
    ];
  });
}
export function uncoveredIds(sentences, ranges) {
  const ids = new Map(sentences.map((s, i) => [s.id, i]));
  const covered = new Set();
  for (const r of ranges) {
    const a = ids.get(r.fromSentenceId),
      b = ids.get(r.toSentenceId);
    if (a === undefined || b === undefined || b < a) continue;
    for (let i = a; i <= b; i++) covered.add(i);
  }
  return sentences.filter((s, i) => !covered.has(i)).map((s) => s.id);
}
export function validateRanges(sentences, ranges) {
  const ids = new Map(sentences.map((x, i) => [x.id, i]));
  const result = [];
  for (const r of Array.isArray(ranges) ? ranges : []) {
    if (!r) continue;
    const a = ids.get(r.fromSentenceId),
      b = ids.get(r.toSentenceId);
    if (
      a === undefined ||
      b === undefined ||
      b < a ||
      !['repeat', 'normal', 'skim'].includes(r.level)
    )
      continue;
    result.push({
      id: `study-${r.fromSentenceId}-${r.toSentenceId}`,
      fromSentenceId: r.fromSentenceId,
      toSentenceId: r.toSentenceId,
      level: r.level,
      reason: String(r.reason || ''),
      tags: Array.isArray(r.tags) ? r.tags.filter((x) => typeof x === 'string') : [],
      terms: Array.isArray(r.terms) ? r.terms.slice(0, 8) : [],
      expressions: Array.isArray(r.expressions) ? r.expressions.slice(0, 4) : [],
      examples: Array.isArray(r.examples) ? r.examples.slice(0, 4) : [],
      start: sentences[a].start,
      end: Math.max(...sentences.slice(a, b + 1).map((s) => s.end)),
    });
  }
  return result;
}
export function mergeStudy(sentences, ranges, overrides = {}) {
  const ids = new Map(sentences.map((s, i) => [s.id, i]));
  return sentences.map((s, i) => {
    const matches = ranges
      .filter(
        (r) =>
          ids.has(r.fromSentenceId) &&
          ids.has(r.toSentenceId) &&
          ids.get(r.fromSentenceId) <= i &&
          ids.get(r.toSentenceId) >= i,
      )
      .sort(
        (a, b) =>
          ids.get(a.toSentenceId) -
          ids.get(a.fromSentenceId) -
          (ids.get(b.toSentenceId) - ids.get(b.fromSentenceId)),
      );
    const r = matches[0];
    return {
      id: `study-${s.id}`,
      fromSentenceId: s.id,
      toSentenceId: s.id,
      start: s.start,
      end: s.end,
      level: overrides[s.id] || r?.level || 'normal',
      reason: overrides[s.id] ? '手动标记' : r?.reason || '未标记重点',
      tags: r?.tags || [],
      terms: r?.terms || [],
      expressions: r?.expressions || [],
      examples: r?.examples || [],
      manual: !!overrides[s.id],
    };
  });
}

// Group only adjacent entries with the same explanation; preserve every source ID.
export function studyGroups(ranges) {
  const groups = [];
  for (const range of ranges) {
    const previous = groups.at(-1);
    const reason = (range.reason || '').trim().replace(/\s+/g, ' ');
    if (
      previous &&
      reason &&
      previous.reasonKey === reason &&
      previous.level === range.level &&
      !!previous.manual === !!range.manual
    ) {
      previous.items.push(range);
      previous.end = Math.max(previous.end, range.end);
      previous.toSentenceId = range.toSentenceId;
    } else groups.push({ ...range, reasonKey: reason, items: [range] });
  }
  return groups;
}

// Restrict a learning unit to adjacent sentences within the displayed chapter.
export function relatedStudySentences(sentences, studyMap, sentenceId) {
  const index = sentences.findIndex((s) => s.id === sentenceId);
  if (index < 0) return [];
  const byId = new Map(studyMap.map((r) => [r.fromSentenceId, r]));
  const current = byId.get(sentenceId),
    reason = current?.reason?.trim().replace(/\s+/g, ' ');
  if (!reason || current.manual || ['未标记重点', '尚未标记', '手动标记'].includes(reason))
    return [sentences[index]];
  const matches = (i) => {
    const r = byId.get(sentences[i]?.id);
    return (
      r &&
      !r.manual &&
      r.level === current.level &&
      r.reason?.trim().replace(/\s+/g, ' ') === reason
    );
  };
  let first = index,
    last = index;
  while (first > 0 && matches(first - 1) && sentences[first].start - sentences[first - 1].end <= 5)
    first--;
  while (
    last + 1 < sentences.length &&
    matches(last + 1) &&
    sentences[last + 1].start - sentences[last].end <= 5
  )
    last++;
  return sentences.slice(first, last + 1);
}
