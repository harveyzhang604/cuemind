import { cachedTranscribe as transcribe } from '../services/completion-cache.js';

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
    s.audio.createMediaStreamSource(s.stream).connect(s.audio.destination);
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
    const current = await position(s);
    if (s.stopping) return finish(s);
    const chunks = [];
    const offset = current.time;
    const recorder = new MediaRecorder(s.stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 64000,
    });
    s.recorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => stop(s, { discard: true, reason: '音频录制失败' });
    recorder.onstop = () => {
      clearTimeout(s.timer);
      const blob = new Blob(chunks, { type: 'audio/webm' }),
        discard = s.discardCurrent;
      s.discardCurrent = false;
      if (!discard && blob.size >= 1000 && !s.controller.signal.aborted) {
        s.pending++;
        s.queue = s.queue.then(async () => {
          if (s.controller.signal.aborted) return;
          try {
            let result;
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                result = await transcribe(blob, s.settings, s.controller.signal);
                break;
              } catch (e) {
                if (attempt || s.controller.signal.aborted) throw e;
              }
            }
            const reply = await send({
              type: 'ASR_CHUNK',
              recordId: s.recordId,
              segments: result.map((x) => ({ ...x, start: x.start + offset, end: x.end + offset })),
              completed: s.completed + 1,
            });
            if (!reply?.ok) throw new Error(reply?.error || '转写结果保存失败');
            s.completed++;
          } catch (e) {
            if (!s.controller.signal.aborted)
              s.errors.push(`${Math.floor(offset)} 秒附近：${e.message}`);
          } finally {
            s.pending--;
          }
        });
      }
      if (s.pending >= 3 && !s.stopping) {
        s.stopping = true;
        s.errors.push('转写速度落后于播放，已停止录音并处理已有音频。');
      }
      if (s.stopping) finish(s);
      else recordChunk(s);
    };
    recorder.start();
    s.timer = setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, 60000);
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
    recordChunk(state);
    reply({ ok: true });
    return;
  }
  if (m.type === 'STOP') {
    stop(state, m);
    reply({ ok: true });
  }
});
