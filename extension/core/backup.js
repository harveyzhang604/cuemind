import { normalizeFocusConfig, normalizeFocusCaches, focusCacheFor } from './focus.js';
import { joinText } from './transcript.js';

const object = (x) => x && typeof x === 'object' && !Array.isArray(x);
const text = (x) => typeof x === 'string';
const time = (x) => Number.isFinite(x) && x >= 0;
export function validateBackup(value) {
  if (
    !object(value) ||
    value.format !== 'cuemind' ||
    value.version !== 1 ||
    !Array.isArray(value.videos) ||
    !Array.isArray(value.notes)
  )
    throw new Error('不是受支持的 CueMind 备份');
  if (JSON.stringify(value).length > 50 * 1024 * 1024) throw new Error('备份文件大于 50 MB');
  const result = { videos: [], notes: [], chats: [] };
  for (const store of Object.keys(result)) {
    const rows = value[store] ?? [];
    if (!Array.isArray(rows) || rows.length > 100000) throw new Error('备份记录列表无效');
    const ids = new Set();
    for (const row of rows) {
      if (!object(row) || !text(row.id) || !row.id || row.id.length > 300 || ids.has(row.id))
        throw new Error('备份记录 ID 无效或重复');
      ids.add(row.id);
      if (store === 'videos') {
        if (
          !object(row.videoInfo) ||
          !text(row.videoInfo.title) ||
          !text(row.videoInfo.platform) ||
          !text(row.videoKey) ||
          !object(row.transcriptMeta) ||
          !Array.isArray(row.rawCaptions) ||
          !Array.isArray(row.sentences) ||
          !Array.isArray(row.paragraphs)
        )
          throw new Error('备份视频记录无效');
        const raw = new Map();
        let previous = -1;
        for (const r of row.rawCaptions) {
          if (
            !object(r) ||
            !text(r.id) ||
            raw.has(r.id) ||
            !text(r.text) ||
            !time(r.start) ||
            !time(r.end) ||
            r.end <= r.start ||
            r.start < previous
          )
            throw new Error('备份原始字幕无效');
          raw.set(r.id, r);
          previous = r.start;
        }
        const covered = [];
        const sentenceIds = new Set();
        for (const s of row.sentences) {
          if (
            !object(s) ||
            !text(s.id) ||
            sentenceIds.has(s.id) ||
            !Array.isArray(s.sourceIds) ||
            !s.sourceIds.length ||
            s.sourceIds.some((id) => !raw.has(id))
          )
            throw new Error('备份句子引用无效');
          const items = s.sourceIds.map((id) => raw.get(id));
          if (
            s.rawText !== joinText(items) ||
            s.start !== items[0].start ||
            s.end !== Math.max(...items.map((x) => x.end))
          )
            throw new Error('备份句子与原始字幕不一致');
          covered.push(...s.sourceIds);
          sentenceIds.add(s.id);
        }
        if (covered.join('\n') !== [...raw.keys()].join('\n'))
          throw new Error('备份字幕存在丢失、重复或错序');
        for (const p of row.paragraphs)
          if (
            !object(p) ||
            !text(p.id) ||
            !time(p.start) ||
            !time(p.end) ||
            p.end <= p.start ||
            !Array.isArray(p.sentenceIds) ||
            !p.sentenceIds.length ||
            p.sentenceIds.some((id) => !sentenceIds.has(id))
          )
            throw new Error('备份复听段引用无效');
        const ranges = (items, study = false) => {
          if (
            !Array.isArray(items) ||
            items.some(
              (r) =>
                !object(r) ||
                !sentenceIds.has(r.fromSentenceId) ||
                !sentenceIds.has(r.toSentenceId) ||
                !time(r.start) ||
                !time(r.end) ||
                r.end <= r.start ||
                (study && !['repeat', 'normal', 'skim'].includes(r.level)),
            )
          )
            throw new Error('备份分析范围无效');
        };
        const analysis = (a) => {
          if (!object(a)) throw new Error('备份章节无效');
          ranges(a.chapters);
          ranges(a.explanations);
          if (
            !Array.isArray(a.quotes) ||
            a.quotes.some(
              (q) =>
                !object(q) || !sentenceIds.has(q.sentenceId) || !text(q.quote) || !time(q.start),
            )
          )
            throw new Error('备份金句无效');
        };
        if (row.studyMap !== undefined) ranges(row.studyMap, true);
        if (row.analysis !== undefined) analysis(row.analysis);
        for (const field of [
          'studyChunks',
          'analysisChunks',
          'boundaryChunks',
          'tasks',
          'overrides',
        ])
          if (row[field] !== undefined && !object(row[field])) throw new Error('备份任务数据无效');
        for (const chunk of Object.values(row.studyChunks || {})) {
          if (!object(chunk)) throw new Error('备份学习地图无效');
          ranges(chunk.ranges, true);
        }
        for (const chunk of Object.values(row.analysisChunks || {})) analysis(chunk);
        if (row.focusConfig !== undefined) row.focusConfig = normalizeFocusConfig(row.focusConfig);
        // Imported AI results are not trusted as completed model work; exact marks are revalidated, progress recomputed.
        if (row.focusCache !== undefined || row.focusCaches !== undefined) {
          row.focusCaches = normalizeFocusCaches(
            row.sentences,
            row.focusCaches,
            row.focusConfig,
            row.focusCache,
          );
          for (const entry of Object.values(row.focusCaches)) {
            entry.cache.done = [];
            entry.cache.failed = [];
            entry.cache.status = 'idle';
          }
          row.focusCache = focusCacheFor({ ...row, focusCache: null }, row.focusConfig || {});
        }
        // Boundary caches can be recomputed; never trust cached provenance from an import.
        delete row.boundaryChunks;
        if (row.tasks?.boundary) delete row.tasks.boundary;
        for (const task of Object.values(row.tasks || {}))
          if (
            !object(task) ||
            !Array.isArray(task.done) ||
            task.done.some((n) => !Number.isInteger(n) || n < 0) ||
            !Array.isArray(task.failed) ||
            task.failed.some((f) => !object(f) || !Number.isInteger(f.index) || !text(f.error))
          )
            throw new Error('备份任务进度无效');
        if (
          Object.entries(row.overrides || {}).some(
            ([id, level]) => !sentenceIds.has(id) || !['repeat', 'normal', 'skim'].includes(level),
          )
        )
          throw new Error('备份手动标记无效');
      } else if (store === 'notes') {
        if (
          !text(row.recordId) ||
          !text(row.body) ||
          !text(row.sourceText) ||
          !time(row.timestamp) ||
          !Array.isArray(row.sentenceIds)
        )
          throw new Error('备份笔记无效');
      } else if (
        !text(row.recordId) ||
        !text(row.question) ||
        !text(row.answer) ||
        !Array.isArray(row.citations) ||
        row.citations.some(
          (c) => !object(c) || !text(c.sentenceId) || !text(c.quote) || !time(c.start),
        )
      )
        throw new Error('备份问答无效');
      result[store].push(row);
    }
  }
  return result;
}
