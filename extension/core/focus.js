// Goal annotations are a view of immutable rawText, never a replacement transcript.
export const FOCUS_VERSION = 1;
export const FOCUS_GOALS = {
  off: '关闭',
  cet4: '四级备考',
  cet6: '六级备考',
  ielts: '雅思备考',
  toefl: '托福备考',
  medical: '医学',
  finance: '金融',
  technology: '计算机',
  custom: '自定义',
};
export const FOCUS_DEFAULTS = {
  goal: 'off',
  customGoal: '',
  baseSize: 14,
  videoSize: 28,
  videoTranslationSize: 18,
  overlay: false,
  overlayLanguage: 'bilingual',
  glossary: [],
  mastered: [],
};
const plain = (x) => x && typeof x === 'object' && !Array.isArray(x);
const clean = (x, max = 160) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const termKey = (x) => x.normalize('NFKC').toLocaleLowerCase();
export function parseGlossary(text) {
  if (typeof text !== 'string') return [];
  return text
    .split(/[\n,，]/)
    .map((line) => {
      const m = line.trim().match(/^(.*?)(?:\s*[:：=]\s*([123]))?$/);
      return { term: clean(m?.[1]), level: Number(m?.[2] || 2) };
    })
    .filter((x) => x.term)
    .slice(0, 300);
}
export function normalizeFocusConfig(input = {}) {
  if (!plain(input)) input = {};
  const glossary =
    typeof input.glossary === 'string'
      ? parseGlossary(input.glossary)
      : Array.isArray(input.glossary)
        ? input.glossary
        : [];
  const seen = new Set(),
    terms = [];
  for (const item of glossary.slice(0, 300)) {
    const term = clean(typeof item === 'string' ? item : item?.term);
    if (!term || /[<>\u0000-\u001f]/.test(term) || seen.has(termKey(term))) continue;
    seen.add(termKey(term));
    terms.push({ term, level: [1, 2, 3].includes(Number(item?.level)) ? Number(item.level) : 2 });
  }
  const mastered = [
    ...new Set(
      (Array.isArray(input.mastered) ? input.mastered : [])
        .slice(0, 500)
        .map((x) => clean(x))
        .filter((x) => x && !/[<>\u0000-\u001f]/.test(x))
        .map(termKey),
    ),
  ];
  const size = (x, f, min, max) =>
    Number.isFinite(Number(x)) ? Math.max(min, Math.min(max, Number(x))) : f;
  return {
    goal: Object.hasOwn(FOCUS_GOALS, input.goal) ? input.goal : 'off',
    customGoal: clean(input.customGoal, 1000),
    baseSize: size(input.baseSize, 14, 12, 28),
    videoSize: size(input.videoSize, 28, 14, 48),
    videoTranslationSize: size(input.videoTranslationSize, 18, 12, 48),
    overlay: input.overlay === true,
    overlayLanguage: ['original', 'bilingual', 'translated'].includes(input.overlayLanguage)
      ? input.overlayLanguage
      : 'bilingual',
    glossary: terms,
    mastered,
  };
}
function fingerprint(value) {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < value.length; i++) {
    const n = value.charCodeAt(i);
    a = Math.imul(a ^ n, 16777619);
    b = Math.imul(b, 33) ^ n;
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
function cacheKey(sentences, goal, description) {
  return `focus-${FOCUS_VERSION}-${fingerprint(JSON.stringify([sentences.map((s) => [s.id, s.rawText]), goal, description]))}`;
}
export function focusCacheKey(sentences, config) {
  const c = normalizeFocusConfig(config);
  return cacheKey(sentences, c.goal, c.goal === 'custom' ? c.customGoal : '');
}
// CJK scripts do not require spaces between words; only alphabetic word runs
// reject partial matches such as capital inside capitalism.
const word = (c) =>
  !!c &&
  /[\p{L}\p{N}_]/u.test(c) &&
  !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(c);
function whole(text, start, end) {
  return !(word(text[start]) && word(text[start - 1])) && !(word(text[end - 1]) && word(text[end]));
}
export function validateFocusMarks(sentences, marks) {
  if (!Array.isArray(marks)) return [];
  const byId = new Map(sentences.map((s) => [s.id, s.rawText])),
    valid = [];
  for (const m of marks.slice(0, 100000)) {
    if (
      !plain(m) ||
      !byId.has(m.sentenceId) ||
      !Number.isInteger(m.start) ||
      !Number.isInteger(m.end) ||
      ![1, 2, 3].includes(m.level)
    )
      continue;
    const text = byId.get(m.sentenceId);
    if (
      m.start < 0 ||
      m.end <= m.start ||
      m.end > text.length ||
      typeof m.text !== 'string' ||
      text.slice(m.start, m.end) !== m.text ||
      !m.text.trim() ||
      /[<>\u0000-\u001f]/.test(m.text) ||
      !whole(text, m.start, m.end)
    )
      continue;
    valid.push({
      sentenceId: m.sentenceId,
      start: m.start,
      end: m.end,
      text: m.text,
      level: m.level,
      reason: clean(m.reason, 300),
      source: m.source === 'glossary' ? 'glossary' : 'ai',
    });
  }
  // Prefer explicit terms and complete phrases over overlapping component words.
  valid.sort(
    (a, b) =>
      (b.source === 'glossary') - (a.source === 'glossary') ||
      b.end - b.start - (a.end - a.start) ||
      b.level - a.level ||
      a.start - b.start,
  );
  const kept = [],
    groups = new Map();
  for (const m of valid) {
    const group = groups.get(m.sentenceId) || [];
    if (!group.some((k) => m.start < k.end && k.start < m.end)) {
      group.push(m);
      groups.set(m.sentenceId, group);
      kept.push(m);
    }
  }
  const order = new Map(sentences.map((s, i) => [s.id, i]));
  return kept.sort(
    (a, b) => order.get(a.sentenceId) - order.get(b.sentenceId) || a.start - b.start,
  );
}
function occurrences(text, term) {
  // Match the original UTF-16 string so case folding cannot shift annotation offsets.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    re = new RegExp(escaped, 'giu'),
    out = [];
  let m;
  while ((m = re.exec(text))) {
    if (whole(text, m.index, m.index + m[0].length))
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    if (!m[0].length) re.lastIndex++;
  }
  return out;
}
export function effectiveFocusMarks(sentences, marks, config) {
  const c = normalizeFocusConfig(config);
  if (c.goal === 'off') return [];
  const glossary = [],
    mastered = [];
  for (const s of sentences) {
    for (const item of c.glossary)
      for (const p of occurrences(s.rawText, item.term))
        glossary.push({
          sentenceId: s.id,
          ...p,
          level: item.level,
          reason: '用户自定义术语',
          source: 'glossary',
        });
    for (const term of c.mastered)
      for (const p of occurrences(s.rawText, term)) mastered.push({ sentenceId: s.id, ...p });
  }
  return validateFocusMarks(sentences, [
    ...glossary,
    ...(Array.isArray(marks) ? marks : []).map((m) => ({ ...m, source: 'ai' })),
  ]).filter(
    (m) =>
      !mastered.some((k) => m.sentenceId === k.sentenceId && k.start <= m.start && k.end >= m.end),
  );
}
export function focusParts(sentence, marks) {
  const text = sentence.rawText || '',
    parts = [];
  let cursor = 0;
  for (const m of validateFocusMarks(
    [sentence],
    (marks || []).filter((x) => x.sentenceId === sentence.id),
  )) {
    if (m.start > cursor) parts.push({ text: text.slice(cursor, m.start), level: 0 });
    parts.push({ text: text.slice(m.start, m.end), level: m.level });
    cursor = m.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), level: 0 });
  return parts.length ? parts : [{ text, level: 0 }];
}
export function focusBatches(sentences) {
  const out = [];
  let current = [],
    length = 0;
  for (const s of sentences) {
    if (current.length && (current.length >= 16 || length + s.rawText.length > 1800)) {
      out.push(current);
      current = [];
      length = 0;
    }
    current.push(s);
    length += s.rawText.length;
  }
  if (current.length) out.push(current);
  return out;
}
export function normalizeFocusCache(sentences, config, input) {
  const key = focusCacheKey(sentences, config),
    total = focusBatches(sentences).length;
  const c = normalizeFocusConfig(config),
    legacyKey = cacheKey(sentences, c.goal, c.customGoal);
  if (!plain(input) || ![key, legacyKey].includes(input.key) || input.version !== FOCUS_VERSION)
    return {
      key,
      version: FOCUS_VERSION,
      marks: [],
      done: [],
      failed: [],
      warnings: [],
      total,
      status: 'idle',
    };
  const done = [
    ...new Set(
      (Array.isArray(input.done) ? input.done : []).filter(
        (i) => Number.isInteger(i) && i >= 0 && i < total,
      ),
    ),
  ];
  const failed = (Array.isArray(input.failed) ? input.failed : [])
    .filter(
      (f) =>
        plain(f) &&
        Number.isInteger(f.index) &&
        f.index >= 0 &&
        f.index < total &&
        !done.includes(f.index),
    )
    .map((f) => ({ index: f.index, error: clean(f.error, 200) }));
  const ids = new Set(sentences.map((s) => s.id));
  const warnings = (Array.isArray(input.warnings) ? input.warnings : [])
    .filter((w) => plain(w) && ids.has(w.sentenceId))
    .map((w) => ({ sentenceId: w.sentenceId, error: clean(w.error, 200) }));
  return {
    ...(typeof input.promptPreference === 'string'
      ? { promptPreference: input.promptPreference.slice(0, 6000) }
      : {}),
    key,
    version: FOCUS_VERSION,
    marks: validateFocusMarks(sentences, input.marks).map((m) => ({ ...m, source: 'ai' })),
    done,
    failed,
    warnings,
    total,
    status: ['idle', 'running', 'partial', 'complete', 'cancelled'].includes(input.status)
      ? input.status
      : 'idle',
  };
}
// A record owns several analyses; focusCache remains the active view for older
// callers. Entries carry their goal identity so backups can validate every key.
export function normalizeFocusCaches(sentences, input, legacyConfig, legacyCache) {
  const caches = {};
  const retain = (config, cache) => {
    if (
      !plain(config) ||
      !Object.hasOwn(FOCUS_GOALS, config.goal) ||
      config.goal === 'off' ||
      !plain(cache)
    )
      return;
    const normalized = normalizeFocusCache(sentences, config, cache);
    if (
      cache.version !== FOCUS_VERSION ||
      ![
        normalized.key,
        cacheKey(sentences, config.goal, normalizeFocusConfig(config).customGoal),
      ].includes(cache.key)
    )
      return;
    caches[normalized.key] = {
      goal: config.goal,
      customGoal: config.goal === 'custom' ? normalizeFocusConfig(config).customGoal : '',
      cache: normalized,
    };
  };
  if (plain(input))
    for (const [key, entry] of Object.entries(input))
      if (plain(entry) && entry.cache?.key === key) retain(entry, entry.cache);
  // Prefer the active legacy mirror when migrating the old single-cache schema.
  retain(legacyConfig, legacyCache);
  return caches;
}
export function focusCacheFor(record, config) {
  const key = focusCacheKey(record.sentences, config),
    entry = record.focusCaches?.[key];
  if (plain(entry) && focusCacheKey(record.sentences, entry) === key)
    return normalizeFocusCache(record.sentences, config, entry.cache);
  return normalizeFocusCache(record.sentences, config, record.focusCache);
}
export function selectFocusConfig(record, input) {
  const config = normalizeFocusConfig(input);
  record.focusCaches = normalizeFocusCaches(
    record.sentences,
    record.focusCaches,
    record.focusConfig,
    record.focusCache,
  );
  // Do not apply the previous goal's legacy cache to the new goal.
  const key = focusCacheKey(record.sentences, config),
    cache = normalizeFocusCache(record.sentences, config, record.focusCaches[key]?.cache);
  record.focusConfig = config;
  record.focusCache = cache;
  if (config.goal !== 'off')
    record.focusCaches[key] = {
      goal: config.goal,
      customGoal: config.goal === 'custom' ? config.customGoal : '',
      cache,
    };
  return { config, cache };
}
