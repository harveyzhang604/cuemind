import { withPreference, focusPrompt } from './prompts.js';
import { cachedCompletion } from './completion-cache.js';
import {
  FOCUS_GOALS,
  normalizeFocusConfig,
  focusCacheFor,
  selectFocusConfig,
  focusBatches,
  validateFocusMarks,
} from '../core/focus.js';

export function focusState(record, defaults = {}) {
  const config = normalizeFocusConfig(record.focusConfig || defaults);
  return { config, cache: focusCacheFor(record, config) };
}

function decode(chunk, data) {
  if (!Array.isArray(data?.items) || data.items.length !== chunk.length)
    throw new Error('重点词分析有漏句，请重试');
  const marks = [];
  for (const s of chunk) {
    const rows = data.items.filter((x) => x?.sentenceId === s.id);
    if (rows.length !== 1 || !Array.isArray(rows[0].marks) || rows[0].marks.length > 3)
      throw new Error('重点词分析的句子或数量无效');
    for (const m of rows[0].marks) {
      if (
        typeof m?.text !== 'string' ||
        !m.text ||
        !Number.isInteger(m.occurrence) ||
        m.occurrence < 0 ||
        m.occurrence > 1000
      )
        throw new Error('重点词定位无效');
      let start = -1,
        from = 0;
      for (let i = 0; i <= m.occurrence; i++) {
        start = s.rawText.indexOf(m.text, from);
        if (start < 0) break;
        from = start + m.text.length;
      }
      if (start < 0) throw new Error('重点词不在原句中');
      const mark = {
        sentenceId: s.id,
        start,
        end: start + m.text.length,
        text: m.text,
        level: m.level,
        reason: m.reason,
        source: 'ai',
      };
      if (validateFocusMarks([s], [mark]).length !== 1)
        throw new Error('重点词不是完整原文词汇或级别无效');
      marks.push(mark);
    }
  }
  const valid = validateFocusMarks(chunk, marks);
  if (valid.length !== marks.length) throw new Error('重点词出现重叠');
  return valid;
}
export async function runFocusTask(record, settings, args = {}, signal, save, progress = () => {}) {
  const { config, cache } = selectFocusConfig(record, focusState(record).config);
  if (config.goal === 'off') {
    await save(record);
    return { config, cache };
  }
  if (config.goal === 'custom' && !config.customGoal && !config.glossary.length)
    throw new Error('请先填写学习目标或自定义术语');
  const preference = (settings.prompts?.focus || '').slice(0, 6000);
  if ((cache.promptPreference || '') !== preference) {
    cache.marks = [];
    cache.done = [];
    cache.failed = [];
    cache.warnings = [];
    cache.status = 'idle';
  }
  cache.promptPreference = preference;
  const chunks = focusBatches(record.sentences);
  const abort = () => {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  };
  const emit = () =>
    progress({
      capability: 'focus',
      completed: cache.done.length,
      total: cache.total,
      failed: cache.failed.length,
      status: cache.status,
    });
  const order = chunks
    .map((chunk, index) => ({
      index,
      distance: Math.min(...chunk.map((s) => Math.abs(s.start - (Number(args.currentTime) || 0)))),
    }))
    .sort((a, b) => a.distance - b.distance)
    .map((x) => x.index);
  const analyzeChunk = async (chunk) => {
    const first = record.sentences.indexOf(chunk[0]),
      last = first + chunk.length;
    const input = {
      goal: FOCUS_GOALS[config.goal],
      description: config.goal === 'custom' ? config.customGoal : '',
      title: record.videoInfo?.title || '',
      neighborContext: {
        before: record.sentences[first - 1]?.rawText || '',
        after: record.sentences[last]?.rawText || '',
      },
      sentences: chunk.map((s) => ({ sentenceId: s.id, text: s.rawText })),
    };
    let structuralError;
    for (let attempt = 0; attempt < 2; attempt++) {
      abort();
      let data;
      try {
        data = await cachedCompletion(
          settings,
          withPreference(focusPrompt, settings, 'focus'),
          attempt
            ? {
                ...input,
                repair:
                  '上次结构或原词位置无效，请完整返回每个句子且逐字匹配原文；没有重点可为空。',
              }
            : input,
          signal,
          'focus',
          (data) => {
            decode(chunk, data);
            return true;
          },
        );
      } catch (e) {
        if (!/模型未返回有效 JSON|模型返回空响应/.test(e.message || '')) throw e;
        structuralError = e;
        continue;
      }
      abort();
      try {
        return decode(chunk, data);
      } catch (e) {
        structuralError = e;
      }
    }
    if (chunk.length > 1) {
      const middle = Math.floor(chunk.length / 2);
      return [
        ...(await analyzeChunk(chunk.slice(0, middle))),
        ...(await analyzeChunk(chunk.slice(middle))),
      ];
    }
    // A repeatedly malformed annotation must not trap an entire video in a
    // permanent retry loop. This one sentence stays readable with normal type.
    cache.warnings = [
      ...(cache.warnings || []),
      {
        sentenceId: chunk[0].id,
        error: String(structuralError?.message || '模型标注无效').slice(0, 200),
      },
    ];
    return [];
  };
  cache.status = 'running';
  await save(record);
  emit();
  try {
    for (const index of order) {
      abort();
      if (cache.done.includes(index)) continue;
      const chunk = chunks[index];
      try {
        const marks = await analyzeChunk(chunk);
        abort();
        const ids = new Set(chunk.map((s) => s.id));
        cache.marks = [...cache.marks.filter((m) => !ids.has(m.sentenceId)), ...marks];
        cache.done.push(index);
        cache.failed = cache.failed.filter((f) => f.index !== index);
      } catch (e) {
        abort();
        cache.failed = [
          ...cache.failed.filter((f) => f.index !== index),
          { index, error: String(e.message || '分析失败').slice(0, 200) },
        ];
        // Credential/quota failures affect every batch; do not hammer the service for the remaining video.
        if (/API Key|额度|访问被拒绝|请求过多/.test(e.message)) {
          await save(record);
          emit();
          break;
        }
      }
      await save(record);
      emit();
    }
    cache.status = cache.failed.length ? 'partial' : 'complete';
    await save(record);
    emit();
    return { config, cache };
  } catch (e) {
    if (signal?.aborted) {
      cache.status = 'cancelled';
      await save(record);
      emit();
    }
    throw e;
  }
}
