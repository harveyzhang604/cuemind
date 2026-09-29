// Official API: https://www.volcengine.com/docs/6561/1631584
export const DOUBAO_ASR_URL =
  'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
export const DOUBAO_ASR_RESOURCE = 'volc.bigasr.auc_turbo';
export const isDoubaoAsr = (settings) => settings.asrUrl?.replace(/\/$/, '') === DOUBAO_ASR_URL;

export function speechSettings(settings, platform) {
  if (settings.asrRouting === 'platform' && ['migu', 'bilibili'].includes(platform))
    return {
      ...settings,
      asrUrl: settings.domesticAsrUrl || DOUBAO_ASR_URL,
      asrModel: settings.domesticAsrModel || DOUBAO_ASR_RESOURCE,
      asrKey: settings.domesticAsrKey || '',
    };
  return settings;
}

export function speechUrl(settings) {
  return isDoubaoAsr(settings)
    ? DOUBAO_ASR_URL
    : `${settings.asrUrl.replace(/\/$/, '')}/audio/transcriptions`;
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

// MediaRecorder produces WebM/Opus, which the Doubao file API does not accept.
// Convert in an extension document, where WebAudio is available, before upload.
export async function prepareSpeechAudio(blob, settings) {
  if (!isDoubaoAsr(settings)) return blob;
  if (blob.size > 24 * 1024 * 1024) throw new Error('音频超过 24 MB，请选择较小文件。');
  if (typeof OfflineAudioContext === 'undefined') throw new Error('请在扩展页面转换音频后重试。');
  const decoder = new OfflineAudioContext(1, 1, 16000);
  const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
  if (decoded.duration > 720) throw new Error('豆包音频导入请分成 12 分钟以内的片段。');
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
