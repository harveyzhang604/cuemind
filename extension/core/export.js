import { formatTime, timestampUrl } from './transcript.js';
const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ');
export function markdown(record, notes = [], includeTranscript = false) {
  const v = record.videoInfo;
  const lines = [
    `# ${clean(v.title)}`,
    '',
    `作者：${clean(v.author)} · ${v.platform}`,
    `来源：${v.url}`,
    '',
  ];
  for (const [index, c] of Object.entries(record.studyChunks || {}))
    if (c.summary) lines.push(`## 学习判断 · 第 ${Number(index) + 1} 部分`, '', c.summary, '');
  if (record.analysis?.chapters?.length) {
    lines.push('## 章节', '');
    for (const c of record.analysis.chapters)
      lines.push(
        `### [${formatTime(c.start)}](${timestampUrl(v, c.start)}) ${clean(c.title)}`,
        '',
        c.summary,
        '',
      );
  }
  if (record.studyMap?.length) {
    lines.push('## 学习地图', '');
    for (const r of record.studyMap.filter((x) => x.level !== 'normal'))
      lines.push(
        `- [${formatTime(r.start)}](${timestampUrl(v, r.start)}) ${r.level === 'repeat' ? '重点复听' : '可略过'}：${clean(r.reason)}`,
      );
    lines.push('');
  }
  if (record.analysis?.quotes?.length) {
    lines.push('## 金句', '');
    for (const q of record.analysis.quotes)
      lines.push(
        `> ${clean(q.quote)}`,
        `[${formatTime(q.start)}](${timestampUrl(v, q.start)})`,
        '',
      );
  }
  lines.push('## 我的笔记', '');
  for (const n of notes)
    lines.push(
      `### [${formatTime(n.timestamp)}](${timestampUrl(v, n.timestamp)})`,
      '',
      n.body || '',
      `> ${clean(n.sourceText)}`,
      '',
    );
  if (includeTranscript) {
    lines.push('## 完整字幕', '');
    for (const s of record.sentences)
      lines.push(
        `[${formatTime(s.start)}](${timestampUrl(v, s.start)}) ${s.rawText}`,
        s.translation || '',
        '',
      );
  }
  return lines.join('\n');
}
const safe = (s) =>
  clean(s)
    .replace(/["`\[\](){}<>:#]/g, ' ')
    .slice(0, 200);
export function mindmap(record) {
  const lines = ['mindmap', `  root((${safe(record.videoInfo.title)}))`];
  const chapters = record.analysis?.chapters || [];
  if (!chapters.length) throw new Error('请先生成概览章节，再导出思维导图。');
  for (const c of chapters)
    lines.push(`    ${safe(c.title)} ${formatTime(c.start)}`, `      ${safe(c.summary)}`);
  return lines.join('\n');
}
export function outline(record) {
  return (
    `# ${clean(record.videoInfo.title)}\n\n` +
    (record.analysis?.chapters || [])
      .map((c) => `- ${formatTime(c.start)} ${clean(c.title)}\n  - ${clean(c.summary)}`)
      .join('\n')
  );
}
export function subtitles(record) {
  const stamp = (t) => {
    const ms = Math.round(t * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return record.sentences
    .map(
      (s, i) =>
        `${i + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.rawText}${s.translation ? '\n' + s.translation : ''}\n`,
    )
    .join('\n');
}
