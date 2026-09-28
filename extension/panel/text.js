import { formatTime } from '../core/transcript.js';
export function transcriptText(r, mode) {
  const v = r.videoInfo;
  return [
    v.title,
    `作者：${v.author || ''}`,
    `来源：${v.url || ''}`,
    `描述：${v.description || '暂无描述'}`,
    '',
    ...(mode === 'raw' ? r.rawCaptions : r.sentences).map(
      (s) =>
        `${formatTime(s.start)} ${mode === 'translated' ? s.translation || s.rawText : s.rawText || s.text}${mode === 'bilingual' && s.translation ? '\n' + s.translation : ''}`,
    ),
  ].join('\n');
}
export function answerText(c) {
  return [
    c.question,
    c.pronunciation,
    c.meaning,
    c.headline,
    c.answer,
    c.answerEn,
    c.supplement ? '补充说明：' + c.supplement : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
export function searchText(s, mode) {
  const original = s.rawText || s.text || '';
  return mode === 'translated'
    ? s.translation || original
    : mode === 'bilingual'
      ? original + '\n' + (s.translation || '')
      : original;
}
export function literalMatches(text, q) {
  if (!q) return [];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...text.matchAll(new RegExp(escaped, 'giu'))].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
}
