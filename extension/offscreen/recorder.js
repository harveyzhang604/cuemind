import { cachedTranscribe as transcribe } from '../services/completion-cache.js';
import { isQwenAsr, prepareSpeechAudio } from '../services/speech.js';

let state = null;
const send = (message) => chrome.runtime.sendMessage(message);
async function position(s) {
  const reply = await send({ type: 'CAPTURE_POSITION', recordId: s.recordId });
  if (!reply?.ok) throw new Error(reply?.error || '录音会话已失效');
  return reply.data;
}
async function prepare(m) {
  if (state) throw new Error('已有录音或转写正在进行');
  const s = {
    recordId: m.recordId,
    controller: new AbortController(),
    settings: m.settings,
    queue: Promise.resolve(),
    completed: 0,
    pending: 0,
    failed: false,
    plan: Array.isArray(m.plan) ? m.plan : [],
    nextIndex: 0,
    stopping: false,
    finishing: false,
    errors: [],
  };
  state = s;
  try {
    s.stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: m.streamId } },
      video: false,
    });
    if (s.stopping) throw new Error('录音启动已取消');
    s.audio = new AudioContext();
    const source = s.audio.createMediaStreamSource(s.stream);
    if (typeof s.audio.createAnalyser === 'function') {
      s.analyser = s.audio.createAnalyser();
      s.analyser.fftSize = 2048;
      source.connect(s.analyser);
      s.analyser.connect(s.audio.destination);
    } else {
      source.connect(s.audio.destination);
    }
    await s.audio.resume();
    s.stream.getAudioTracks().forEach((track) =>
      track.addEventListener('ended', () => stop(s, { reason: '音频标签页已关闭' }), {
        once: true,
      }),
    );
  } catch (e) {
    s.stream?.getTracks().forEach((t) => t.stop());
    await s.audio?.close().catch(() => {});
    if (state === s) state = null;
    throw e;
  }
}
async function recordChunk(s) {
  if (s.stopping) return finish(s);
  try {
    const segment = s.plan[s.nextIndex];
    if (!segment) return stop(s);
    const current = await position(s);
    if (s.stopping) return finish(s);
    if (current.unavailable || (current.readyState != null && current.readyState < 2))
      throw new Error('播放器正在重新加载，音频采集已停止；此前完成的字幕已保留。');
    const chunks = [];
    const offset = current.time;
    if (segment.end - offset < 1) return stop(s);
    const samples = s.analyser ? new Uint8Array(s.analyser.fftSize) : null;
    let audioLevel = 0;
    const sampleAudio = () => {
      if (!samples) return;
      s.analyser.getByteTimeDomainData(samples);
      let power = 0;
      for (const value of samples) power += ((value - 128) / 128) ** 2;
      audioLevel = Math.max(audioLevel, Math.sqrt(power / samples.length));
    };
    const recorder = new MediaRecorder(s.stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 64000,
    });
    s.recorder = recorder;
    s.nextIndex++;
    await send({
      type: 'ASR_PROGRESS',
      recordId: s.recordId,
      segmentId: segment.id,
      status: 'capturing',
      start: offset,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => stop(s, { discard: true, reason: '音频录制失败' });
    recorder.onstop = () => {
      clearTimeout(s.timer);
      clearInterval(s.meterTimer);
      sampleAudio();
      const blob = new Blob(chunks, { type: 'audio/webm' }),
        discard = s.discardCurrent;
      const endPosition = position(s).catch(() => null);
      s.discardCurrent = false;
      if (!discard && blob.size >= 1000 && !s.controller.signal.aborted) {
        const waiting = s.pending
          ? send({
              type: 'ASR_PROGRESS',
              recordId: s.recordId,
              segmentId: segment.id,
              status: 'queued',
              audioBytes: blob.size,
              audioLevel,
            }).catch(() => {})
          : Promise.resolve();
        s.pending++;
        s.queue = s.queue.then(async () => {
          try {
            await waiting;
            if (s.controller.signal.aborted || s.failed) return;
            const endState = await endPosition;
            const capturedEnd = Math.min(
              segment.end,
              Math.max(offset + 0.1, Number(endState?.time) || segment.end),
            );
            const timeoutMs = isQwenAsr(s.settings)
              ? Math.min(120000, Math.max(60000, Math.round((segment.end - offset) * 2000)))
              : Math.min(75000, Math.max(45000, Math.round((segment.end - offset) * 1250)));
            await send({
              type: 'ASR_PROGRESS',
              recordId: s.recordId,
              segmentId: segment.id,
              status: 'recognizing',
              end: capturedEnd,
              timeoutMs,
              audioBytes: blob.size,
              audioLevel,
            });
            const audio = await prepareSpeechAudio(blob, s.settings);
            const result = await transcribe(audio, s.settings, s.controller.signal, undefined, {
              timeoutMs,
            });
            const reply = await send({
              type: 'ASR_CHUNK',
              recordId: s.recordId,
              segmentId: segment.id,
              capturedEnd,
              segments: result.map((x) => ({ ...x, start: x.start + offset, end: x.end + offset })),
              completed: s.completed + 1,
            });
            if (!reply?.ok) throw new Error(reply?.error || '转写结果保存失败');
            s.completed++;
          } catch (e) {
            if (!s.controller.signal.aborted) {
              s.failed = true;
              s.errors.unshift(`${Math.floor(offset)} 秒附近：${e.message}`);
              await send({
                type: 'ASR_PROGRESS',
                recordId: s.recordId,
                segmentId: segment.id,
                status: 'failed',
                error: e.message,
              }).catch(() => {});
              stop(s, { discard: true });
            }
          } finally {
            s.pending--;
          }
        });
      }
      if (blob.size < 1000 && !discard && !s.controller.signal.aborted) {
        s.failed = true;
        s.stopping = true;
        s.errors.unshift(`${Math.floor(offset)} 秒附近：这一段没有可识别的音频`);
        send({
          type: 'ASR_PROGRESS',
          recordId: s.recordId,
          segmentId: segment.id,
          status: 'failed',
          error: '这一段没有可识别的音频',
        })
          .catch(() => {})
          .finally(() => finish(s));
        return;
      }
      if (s.pending >= 2 && !s.stopping) {
        s.stopping = true;
        s.errors.push('语音服务处理速度落后于播放，已停止采集并处理已录好的音频。');
      }
      if (s.stopping) finish(s);
      else recordChunk(s);
    };
    recorder.start();
    if (samples) s.meterTimer = setInterval(sampleAudio, 250);
    s.timer = setTimeout(
      () => {
        if (recorder.state !== 'inactive') recorder.stop();
      },
      Math.max(1000, Math.round((segment.end - offset) * 1000)),
    );
  } catch (e) {
    stop(s, { discard: true, reason: e.message });
  }
}
function stop(s, { cancel = false, discard = false, reason } = {}) {
  if (!s) return;
  s.stopping = true;
  s.discardCurrent ||= discard || cancel;
  if (reason && !s.errors.includes(reason)) s.errors.push(reason);
  if (cancel) s.controller.abort();
  if (s.recorder?.state !== 'inactive' && s.recorder) s.recorder.stop();
  else finish(s);
}
async function finish(s) {
  if (s.finishing) return;
  s.finishing = true;
  clearTimeout(s.timer);
  clearInterval(s.meterTimer);
  s.stream?.getTracks().forEach((t) => t.stop());
  await s.audio?.close().catch(() => {});
  await s.queue;
  await send({
    type: 'ASR_FINISHED',
    recordId: s.recordId,
    error: s.errors.join('；'),
    canceled: s.controller.signal.aborted,
  }).catch(() => {});
  if (state === s) state = null;
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  // Content scripts must not be able to start or stop the offscreen recorder.
  if (
    m?.target !== 'offscreen' ||
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL('background.js')
  )
    return;
  if (m.type === 'START') {
    prepare(m)
      .then(() => reply({ ok: true }))
      .catch((e) => reply({ ok: false, error: e.message }));
    return true;
  }
  if (m.type === 'RUN') {
    if (!state || state.recordId !== m.recordId) {
      reply({ ok: false, error: '录音尚未准备好' });
      return;
    }
    const session = state;
    recordChunk(session)
      .then(() =>
        reply({
          ok: !session.stopping,
          ...(session.stopping ? { error: session.errors.at(-1) || '音频采集未能开始' } : {}),
        }),
      )
      .catch((error) => reply({ ok: false, error: error.message }));
    return true;
  }
  if (m.type === 'STOP') {
    stop(state, m);
    reply({ ok: true });
  }
});
