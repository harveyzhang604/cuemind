export function tokens(text) {
  return (
    String(text || '')
      .toLowerCase()
      .match(/[a-z0-9_]+|[\p{Script=Han}]/gu) || []
  );
}
export function retrieve(sentences, question, currentTime = 0, selectedIds = [], maxChars = 18000) {
  const terms = [...new Set(tokens(question))],
    chosen = new Set(selectedIds);
  const scored = sentences
    .map((s, i) => {
      const text = `${s.rawText} ${s.translation || ''}`.toLowerCase();
      return {
        i,
        score:
          terms.reduce((v, t) => v + (text.includes(t) ? (t.length > 1 ? 3 : 1) : 0), 0) +
          (chosen.has(s.id) ? 100 : 0) +
          (Math.abs(s.start - currentTime) < 45 ? 0.5 : 0),
      };
    })
    .sort((a, b) => b.score - a.score);
  const indices = new Set();
  let size = 0;
  // Reserve a small part of long-video retrieval for coverage across the timeline.
  // Otherwise broad questions with few lexical matches see only the opening.
  if (sentences.reduce((n, s) => n + s.rawText.length + 70, 0) > maxChars) {
    const coverageBudget = maxChars * 0.25;
    for (let n = 0; n < 12; n++) {
      const i = Math.round((n * (sentences.length - 1)) / 11),
        cost = sentences[i].rawText.length + 70;
      if (!indices.has(i) && size + cost <= coverageBudget) {
        indices.add(i);
        size += cost;
      }
    }
  }
  for (const hit of scored) {
    for (const i of [hit.i, hit.i - 1, hit.i + 1]) {
      if (i < 0 || i >= sentences.length || indices.has(i)) continue;
      const cost = sentences[i].rawText.length + 70;
      if (size + cost > maxChars) continue;
      indices.add(i);
      size += cost;
    }
  }
  return [...indices].sort((a, b) => a - b).map((i) => sentences[i]);
}
export function qaContext(
  sentences,
  {
    question = '',
    currentTime = 0,
    selectedIds = [],
    scope = 'video',
    history = [],
    paragraphs = [],
  } = {},
) {
  const chosen = new Set(selectedIds);
  const anchor =
    sentences.find((s) => chosen.has(s.id)) ||
    sentences.find((s) => s.start <= currentTime && s.end > currentTime) ||
    sentences.findLast((s) => s.start <= currentTime) ||
    sentences[0];
  if (!anchor) return [];
  if (scope === 'sentence') {
    const i = sentences.indexOf(anchor);
    return sentences.slice(Math.max(0, i - 1), Math.min(sentences.length, i + 2));
  }
  if (scope === 'segment') {
    const explicit = sentences.filter((s) => chosen.has(s.id));
    if (explicit.length > 1) {
      const from = Math.min(...explicit.map((s) => s.start)),
        to = Math.max(...explicit.map((s) => s.end));
      return sentences.filter((s) => s.start >= from && s.start < to);
    }
    const paragraph = paragraphs.find((p) => p.sentenceIds?.includes(anchor.id));
    if (paragraph) {
      const ids = new Set(paragraph.sentenceIds);
      return sentences.filter((s) => ids.has(s.id));
    }
    const selected = sentences.filter((s) => chosen.has(s.id));
    const start = Math.max(0, Math.min(anchor.start, ...selected.map((s) => s.start)) - 30),
      end = Math.max(anchor.end, ...selected.map((s) => s.end)) + 30;
    return sentences.filter((s) => s.end > start && s.start <= end);
  }
  const previous = Array.isArray(history) ? history.at(-1)?.question || '' : '';
  return retrieve(sentences, `${question} ${previous}`, anchor.start, selectedIds);
}
export function validateAnswer(data, context) {
  const byId = new Map(context.map((s) => [s.id, s]));
  const refs = [];
  for (const r of Array.isArray(data?.citations) ? data.citations : []) {
    const s = byId.get(r?.sentenceId);
    if (!s || typeof r.quote !== 'string' || !r.quote.trim() || !s.rawText.includes(r.quote.trim()))
      continue;
    if (!refs.some((x) => x.sentenceId === s.id && x.quote === r.quote.trim()))
      refs.push({ sentenceId: s.id, quote: r.quote.trim(), start: s.start });
  }
  return {
    headline: typeof data?.headline === 'string' ? data.headline.trim() : '',
    answer: typeof data?.answer === 'string' ? data.answer : '字幕中未找到足够依据。',
    answerEn: typeof data?.answerEn === 'string' ? data.answerEn.trim() : '',
    pronunciation: typeof data?.pronunciation === 'string' ? data.pronunciation.trim() : '',
    meaning: typeof data?.meaning === 'string' ? data.meaning.trim() : '',
    supplement: typeof data?.supplement === 'string' ? data.supplement.trim() : '',
    citations: refs,
    rejectedCitations: (Array.isArray(data?.citations) ? data.citations : []).filter(
      (r) => !refs.some((x) => x.sentenceId === r?.sentenceId && x.quote === r?.quote?.trim?.()),
    ).length,
    verified: refs.length > 0,
  };
}
