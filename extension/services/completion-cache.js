import { completion, transcribe, defaults } from './ai-provider.js';
import { isDoubaoAsr } from './speech.js';
import * as db from '../storage/db.js';

export async function completionCacheKey(settings, system, input, capability) {
  const cfg = { ...defaults, ...settings };
  const signature = JSON.stringify([
    'completion-v1',
    cfg.provider,
    cfg.baseUrl,
    cfg.models?.[capability] || cfg.model,
    cfg.maxTokens,
    system,
    input,
  ]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
// Only structurally complete responses are reusable. A partial/malformed answer
// still reaches the caller for repair or partial progress, but never poisons a retry.
export async function cachedCompletion(
  settings,
  system,
  input,
  signal,
  capability,
  reusable,
  options = {},
) {
  const abort = () => {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  };
  const valid = (data) => {
    try {
      return reusable(data) === true;
    } catch {
      return false;
    }
  };
  abort();
  const storage =
    options.storage ||
    (typeof indexedDB !== 'undefined'
      ? {
          get: (id) => db.get('aiCache', id),
          put: (row) => db.put('aiCache', row),
          remove: (id) => db.remove('aiCache', id),
        }
      : null);
  const id = storage ? await completionCacheKey(settings, system, input, capability) : null;
  if (id && !options.force) {
    const row = await storage.get(id);
    abort();
    if (row && valid(row.data)) return structuredClone(row.data);
    if (row) await storage.remove(id);
  }
  const data = await (options.generate || completion)(settings, system, input, signal, capability);
  abort();
  if (id && valid(data))
    await storage.put({ id, data: structuredClone(data), createdAt: Date.now() });
  return data;
}

export async function cachedTranscribe(blob, settings, signal, filename, options) {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  if (blob.size > 24 * 1024 * 1024)
    throw new Error('音频超过 24 MB，请选择较小文件或使用分块录音。');
  if (typeof indexedDB === 'undefined')
    return transcribe(blob, settings, signal, filename, options);
  const cfg = { ...defaults, ...settings };
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const audioHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  const id = await completionCacheKey(
    { provider: 'asr', baseUrl: cfg.asrUrl, model: cfg.asrModel, models: {}, maxTokens: null },
    'asr-v1',
    { audioHash, type: blob.type },
    'asr',
  );
  const saved = await db.get('aiCache', id);
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  if (
    Array.isArray(saved?.data) &&
    (saved.data.length || isDoubaoAsr(cfg.asrUrl)) &&
    saved.data.every(
      (s) =>
        typeof s?.text === 'string' &&
        !!s.text.trim() &&
        Number.isFinite(s.start) &&
        Number.isFinite(s.end) &&
        s.start >= 0 &&
        s.end > s.start,
    )
  )
    return saved.data;
  const segments = await transcribe(blob, settings, signal, filename, options);
  await db.put('aiCache', { id, data: segments, createdAt: Date.now() });
  return segments;
}
