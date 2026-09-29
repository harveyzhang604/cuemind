// Official API: https://www.volcengine.com/docs/6561/1631584
export const DOUBAO_ASR_URL =
  'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
export const DOUBAO_ASR_RESOURCE = 'volc.bigasr.auc_turbo';
export const QWEN_ASR_URL = 'https://dashscope.aliyuncs.com/api/v1';
export const QWEN_ASR_MODEL = 'qwen-audio-3.1-asr-flash';
export const isDoubaoAsr = (settings) => settings.asrUrl?.replace(/\/$/, '') === DOUBAO_ASR_URL;
export const isQwenAsr = (settings) => settings.asrUrl?.replace(/\/$/, '') === QWEN_ASR_URL;

export function speechSettings(settings, platform) {
  if (settings.asrRouting === 'platform' && ['migu', 'bilibili'].includes(platform))
    return {
      ...settings,
      asrUrl: settings.domesticAsrUrl || QWEN_ASR_URL,
      asrModel: settings.domesticAsrModel || QWEN_ASR_MODEL,
      asrKey: settings.domesticAsrKey || '',
    };
  return settings;
}

export function speechUrl(settings) {
  if (isDoubaoAsr(settings)) return DOUBAO_ASR_URL;
  if (isQwenAsr(settings)) return `${QWEN_ASR_URL}/services/aigc/multimodal-generation/generation`;
  return `${settings.asrUrl.replace(/\/$/, '')}/audio/transcriptions`;
}

// No credentials or audio are sent. An HTTP response proves reachability only,
// not account access or transcription quality. Do not change system proxy rules.
export async function checkSpeechNetwork(settings, signal) {
  const url = speechUrl(settings);
  const host = new URL(url).hostname;
  if (host === 'api.deepseek.com')
    throw new Error('DeepSeek 用于文本翻译，不能填写为语音识别地址。请选择独立 ASR 服务。');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 8000);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
    });
    if (response.status >= 500 || response.status === 407)
      throw new Error(`语音服务 ${host} 返回 HTTP ${response.status}，请稍后再试。`);
    return { host, elapsedMs: Date.now() - started, status: response.status };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    if (error.message.startsWith('语音服务 ')) throw error;
    throw new Error(
      `无法连接语音服务 ${host}（8 秒内未能建立连接）。咪咕能播放不代表 ASR 地址可达；请使用当前网络可访问的语音服务，或检查分流与服务访问权限。`,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function pcmWave(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const label = (offset, value) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  label(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// MediaRecorder produces WebM/Opus, which the Qwen and Doubao APIs do not accept here.
// Convert in an extension document, where WebAudio is available, before upload.
export async function prepareSpeechAudio(blob, settings) {
  if (!isDoubaoAsr(settings) && !isQwenAsr(settings)) return blob;
  if (blob.size > 24 * 1024 * 1024) throw new Error('音频超过 24 MB，请选择较小文件。');
  if (typeof OfflineAudioContext === 'undefined') throw new Error('请在扩展页面转换音频后重试。');
  const decoder = new OfflineAudioContext(1, 1, 16000);
  const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
  const maxDuration = isQwenAsr(settings) ? 300 : 720;
  if (decoded.duration > maxDuration)
    throw new Error(`此语音模型的音频导入请分段，每段不超过 ${maxDuration / 60} 分钟。`);
  const context = new OfflineAudioContext(
    1,
    Math.max(1, Math.ceil(decoded.duration * 16000)),
    16000,
  );
  const source = context.createBufferSource();
  source.buffer = decoded;
  source.connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  return pcmWave(rendered.getChannelData(0));
}

export async function qwenRequest(blob, settings) {
  if (!/^qwen-audio-3\.[01]-asr-flash$/.test(settings.asrModel))
    throw new Error(
      '阿里千问直接转写请选择 qwen-audio-3.1-asr-flash 或 qwen-audio-3.0-asr-flash；filetrans 模型需要异步文件任务。',
    );
  if (blob.type.split(';')[0] !== 'audio/wav') throw new Error('千问语音需要先将音频转换为 WAV。');
  if (blob.size > 7_500_000) throw new Error('单段音频过大，请使用短于 3 分钟的 WAV 片段。');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return {
    headers: {
      Authorization: `Bearer ${settings.asrKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-SSE': settings.asrModel.includes('3.0') ? 'enable' : 'disable',
    },
    body: JSON.stringify({
      model: settings.asrModel,
      input: {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: `data:audio/wav;base64,${btoa(binary)}` },
              },
            ],
          },
        ],
      },
      parameters: {
        format: 'wav',
        sample_rate: '16000',
        ...(settings.asrModel.includes('3.1') ? { speaker_diarization_enabled: true } : {}),
      },
    }),
  };
}

const compareSpeech = (value) =>
  String(value || '')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
export function qwenSegments(data) {
  const events = Array.isArray(data) ? data : [data];
  const finished = new Map();
  let completeText = '';
  let hasFinalText = false;
  for (const event of events) {
    if (event?.code)
      throw new Error(
        `千问语音识别失败（${event.code}）：${String(event.message || '请检查 Key、模型与额度').slice(0, 180)}`,
      );
    const output = event?.output?.output || event?.output || {};
    if (typeof output.text === 'string') {
      completeText = output.text;
      hasFinalText = true;
    }
    for (const row of Array.isArray(output.sentences)
      ? output.sentences
      : output.sentence
        ? [output.sentence]
        : []) {
      if (!row?.sentence_end || !Number.isFinite(row.begin_time) || !Number.isFinite(row.end_time))
        continue;
      finished.set(row.sentence_id ?? `${row.begin_time}:${row.end_time}`, row);
    }
  }
  const rows = [...finished.values()].sort((a, b) => a.begin_time - b.begin_time);
  if (!rows.length && hasFinalText && !completeText.trim()) return [];
  if (
    !rows.length ||
    !rows.every(
      (row) => typeof row.text === 'string' && row.text.trim() && row.end_time > row.begin_time,
    ) ||
    (hasFinalText &&
      !compareSpeech(rows.map((row) => row.text).join('')).includes(compareSpeech(completeText)))
  )
    throw new Error(
      '千问只返回了部分句子的时间戳，本段未保存，请改用千问 3.1 同步 Flash 或缩短片段重试。',
    );
  return rows.map((row) => ({
    start: row.begin_time / 1000,
    end: row.end_time / 1000,
    text: row.text,
  }));
}

export function parseQwenResponse(raw, contentType = '') {
  if (!contentType.includes('text/event-stream')) return JSON.parse(raw);
  return raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== '[DONE]')
    .map((line) => JSON.parse(line));
}

export async function doubaoRequest(blob, settings) {
  if (
    !['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg'].includes(
      blob.type.split(';')[0],
    )
  )
    throw new Error('豆包语音需要 WAV、MP3 或 OGG/Opus，请先转换音频格式。');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': settings.asrKey,
      'X-Api-Resource-Id': settings.asrModel,
      'X-Api-Request-Id': crypto.randomUUID(),
      'X-Api-Sequence': '-1',
    },
    body: JSON.stringify({
      user: { uid: 'cuemind' },
      audio: { data: btoa(binary) },
      request: { model_name: 'bigmodel', show_utterances: true },
    }),
  };
}

export function doubaoSegments(data, status) {
  if (status === '20000003') return [];
  if (status && status !== '20000000') {
    const reasons = {
      45000001: '请求参数无效',
      45000002: '音频为空',
      45000151: '音频格式不受支持',
      55000031: '语音服务繁忙，请稍后重试',
    };
    throw new Error(
      `豆包语音识别失败（${status}）：${reasons[status] || '请检查语音服务 Key、极速版权限和额度'}`,
    );
  }
  return data.result?.utterances?.map((row) => ({
    start: Number.isFinite(row.start_time) ? row.start_time / 1000 : NaN,
    end: Number.isFinite(row.end_time) ? row.end_time / 1000 : NaN,
    text: row.text,
  }));
}
