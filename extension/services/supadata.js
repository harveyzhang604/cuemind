import { normalizeCaptions } from '../core/transcript.js';
import { limitedText } from './ai-provider.js';

const API = 'https://api.supadata.ai/v1/transcript';
const fail = (status) =>
  new Error(
    {
      206: 'Supadata 没有找到平台原生字幕。可导入字幕或使用语音转写。',
      401: 'Supadata API Key 无效，请在设置中检查。',
      403: 'Supadata 访问被拒绝，请检查账号权限或视频公开状态。',
      404: 'Supadata 未找到视频或原生字幕。',
      429: 'Supadata 请求受限或额度不足，请检查账号后重试。',
    }[status] || `Supadata 返回 HTTP ${status}，请稍后重试。`,
  );
export function parseSupadata(data) {
  const result = data?.result || data;
  if (!Array.isArray(result?.content)) throw new Error('Supadata 未返回带时间戳的字幕。');
  const raw = normalizeCaptions(
    result.content
      .filter(
        (x) =>
          typeof x?.text === 'string' && Number.isFinite(x.offset) && Number.isFinite(x.duration),
      )
      .map((x) => ({
        text: x.text.replace(/>>\s?/g, '').trim(),
        start: x.offset / 1000,
        end: (x.offset + x.duration) / 1000,
      })),
    'supadata_native',
  );
  if (!raw.length) throw new Error('Supadata 返回了空字幕。');
  return {
    raw,
    language: typeof result.lang === 'string' ? result.lang : '',
    availableLangs: Array.isArray(result.availableLangs)
      ? result.availableLangs.filter((x) => typeof x === 'string')
      : [],
  };
}
export async function fetchSupadata(
  info,
  settings,
  { signal, fetchImpl = fetch, pollMs = 1000, maxPolls = 60 } = {},
) {
  if (info?.platform !== 'youtube' || !/^[\w-]{6,20}$/.test(info.videoId || ''))
    throw new Error('Supadata 仅用于当前公开 YouTube 视频。');
  if (!settings.supadataApiKey) throw new Error('请先在设置中填写 Supadata API Key。');
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, Math.min(180000, Math.max(5000, settings.timeout || 90000)));
  const read = async (url) => {
    const response = await fetchImpl(url, {
      headers: { 'x-api-key': settings.supadataApiKey },
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
    });
    if (!response.ok || response.status === 206) throw fail(response.status);
    return { status: response.status, data: JSON.parse(await limitedText(response, 5_000_000)) };
  };
  const wait = () =>
    new Promise((resolve, reject) => {
      if (controller.signal.aborted) return reject(new DOMException('已取消', 'AbortError'));
      const canceled = () => {
        clearTimeout(id);
        reject(new DOMException('已取消', 'AbortError'));
      };
      const id = setTimeout(() => {
        controller.signal.removeEventListener('abort', canceled);
        resolve();
      }, pollMs);
      controller.signal.addEventListener('abort', canceled, { once: true });
    });
  try {
    const url = new URL(API);
    url.searchParams.set('url', `https://www.youtube.com/watch?v=${info.videoId}`);
    url.searchParams.set('text', 'false');
    url.searchParams.set('mode', 'native');
    if (info.audioLanguage) url.searchParams.set('lang', info.audioLanguage);
    const response = await read(url.href);
    if (response.status !== 202) return parseSupadata(response.data);
    const jobId = response.data?.jobId;
    if (typeof jobId !== 'string' || !jobId || jobId.length > 300)
      throw new Error('Supadata 异步任务 ID 无效。');
    for (let i = 0; i < maxPolls; i++) {
      await wait();
      const { data } = await read(`${API}/${encodeURIComponent(jobId)}`);
      if (data.status === 'completed') return parseSupadata(data);
      if (data.status === 'failed') throw new Error('Supadata 字幕任务失败，请稍后重试。');
      if (!['queued', 'active'].includes(data.status))
        throw new Error('Supadata 返回未知任务状态。');
    }
    throw new Error('Supadata 字幕任务超时，可稍后重试。');
  } catch (e) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    if (controller.signal.aborted) throw new Error('Supadata 请求超时，请稍后重试。');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
