import {
  DOUBAO_ASR_URL,
  DOUBAO_ASR_RESOURCE,
  isDoubaoAsr,
  speechUrl,
  doubaoRequest,
  doubaoSegments,
} from './speech.js';
export const defaults = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  timeout: 90000,
  maxTokens: 6000,
  targetLanguage: '简体中文',
  preBuffer: 0.15,
  postBuffer: 0.15,
  asrUrl: 'https://api.openai.com/v1',
  asrModel: 'whisper-1',
  asrKey: '',
  asrRouting: 'shared',
  domesticAsrUrl: DOUBAO_ASR_URL,
  domesticAsrModel: DOUBAO_ASR_RESOURCE,
  domesticAsrKey: '',
  transcriptProvider: 'platform',
  supadataApiKey: '',
  prompts: {},
  models: {},
};
export function endpoint(value) {
  const u = new URL(value);
  if (
    u.protocol !== 'https:' &&
    !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))
  )
    throw new Error('模型地址须使用 HTTPS，本机服务可使用 HTTP。');
  if (u.username || u.password || u.search || u.hash)
    throw new Error('模型地址不能包含账户、查询参数或片段。');
  return u.href.replace(/\/$/, '');
}
export function parseJson(text) {
  try {
    const value = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, ''),
    );
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error('模型未返回有效 JSON 对象，可重试此任务。');
  }
}
export async function limitedText(response, maxBytes = 2_000_000) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0,
    text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('服务响应过大');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
export async function completion(settings, system, input, signal, capability = '') {
  const s = { ...defaults, ...settings };
  const base = endpoint(s.baseUrl),
    model = s.models?.[capability] || s.model;
  if (!s.apiKey && !['localhost', '127.0.0.1'].includes(new URL(base).hostname))
    throw new Error('请先在模型设置中填写 API Key。');
  let url,
    body,
    headers = { 'Content-Type': 'application/json' };
  if (s.provider === 'gemini') {
    url = `${base}/models/${encodeURIComponent(model)}:generateContent`;
    headers['x-goog-api-key'] = s.apiKey;
    body = {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: s.maxTokens },
    };
  } else {
    url = `${base}/chat/completions`;
    if (s.apiKey) headers.Authorization = `Bearer ${s.apiKey}`;
    body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(input) },
      ],
      temperature: 0.2,
      max_tokens: s.maxTokens,
    };
  }
  if (s.provider === 'deepseek') {
    body.thinking = { type: 'disabled' };
    body.response_format = { type: 'json_object' };
  }
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), Math.min(180000, Math.max(5000, s.timeout)));
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        const friendly = { 401: 'API Key 无效', 403: '模型访问被拒绝', 429: '请求过多或额度不足' };
        const error = new Error(
          friendly[response.status] || `模型服务返回 HTTP ${response.status}`,
        );
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const text = await limitedText(response);
      const data = JSON.parse(text);
      const result =
        s.provider === 'gemini'
          ? data.candidates?.[0]?.content?.parts?.map((x) => x.text || '').join('')
          : data.choices?.[0]?.message?.content;
      if (!result) {
        if (s.provider === 'deepseek' && attempt === 0) delete body.response_format;
        const e = new Error('模型返回空响应');
        e.retryable = true;
        throw e;
      }
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      return parseJson(result);
    } catch (e) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      if (e.name === 'AbortError') throw new Error('模型请求超时，请重试或换用更快模型。');
      last = e;
      if (!e.retryable || attempt === 1) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  throw last;
}
export async function transcribe(blob, settings, signal, filename, options = {}) {
  const s = { ...defaults, ...settings };
  if (!s.asrKey) throw new Error('请先配置 ASR API Key。');
  if (new URL(endpoint(s.asrUrl)).hostname === 'api.deepseek.com')
    throw new Error('DeepSeek 用于文本翻译，请为音频识别配置独立 ASR 服务。');
  if (blob.size > 24 * 1024 * 1024)
    throw new Error('音频超过 24 MB，请选择较小文件或使用分块录音。');
  const extensions = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'video/mp4': 'mp4',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
  };
  const name =
    typeof filename === 'string' && /\.(mp3|mp4|m4a|wav|webm|ogg|flac)$/i.test(filename)
      ? filename
      : `audio.${extensions[blob.type.split(';')[0]] || 'webm'}`;
  const form = new FormData();
  form.append('file', blob, name);
  form.append('model', s.asrModel);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  const doubao = isDoubaoAsr(s);
  const request = doubao
    ? await doubaoRequest(blob, s)
    : { headers: { Authorization: `Bearer ${s.asrKey}` }, body: form };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.min(180000, Math.max(5000, options.timeoutMs))
    : 180000;
  const timer = setTimeout(abort, timeoutMs);
  let stage = '上传音频或等待服务响应';
  try {
    const response = await fetch(speechUrl({ ...s, asrUrl: endpoint(s.asrUrl) }), {
      method: 'POST',
      ...request,
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      const reason = {
        401: 'API Key 无效',
        403: '语音模型访问被拒绝',
        429: '请求过多或额度不足',
      }[response.status];
      throw new Error(reason || `ASR 请求失败（HTTP ${response.status}），请检查服务状态。`);
    }
    stage = '接收识别结果';
    if (doubao && response.headers.get('X-Api-Status-Code') === '20000003') {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      return [];
    }
    const data = JSON.parse(await limitedText(response, 5_000_000));
    if (doubao) data.segments = doubaoSegments(data, response.headers.get('X-Api-Status-Code'));
    if (
      !Array.isArray(data.segments) ||
      !data.segments.length ||
      data.segments.some(
        (x) =>
          !x ||
          typeof x.text !== 'string' ||
          !x.text.trim() ||
          !Number.isFinite(x.start) ||
          !Number.isFinite(x.end) ||
          x.start < 0 ||
          x.end <= x.start,
      )
    )
      throw new Error(
        doubao
          ? '豆包语音未返回有效的分句时间戳，请检查音频是否包含语音。'
          : 'ASR 未返回有效的带时间戳 segments，请使用支持 verbose_json 的模型。',
      );
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    return data.segments;
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted)
      throw new Error(
        `ASR 请求在${stage}阶段超过 ${Math.ceil(timeoutMs / 1000)} 秒仍无响应；已采集 ${Math.max(1, Math.round(blob.size / 1024))} KB 音频，请检查语音服务或网络。`,
      );
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
