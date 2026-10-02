import { saveAudio } from '../storage/audio.js';
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
    videoKey: m.videoKey,
    audioOnly: m.audioOnly === true,
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
async function waitForAudioTime(s, target) {
  let lastTime = -1;
  let lastProgressAt = Date.now();
  while (!s.stopping) {
    const current = await position(s);
    if (current.mediaErrorCode || current.unavailable)
      throw new Error('播放器报告媒体错误，音频采集已停止。');
    if (current.time >= target || current.time >= current.duration - 0.15) return current;
    if (current.paused) throw new Error('视频播放已暂停，整片音频采集已停止。');
    if (current.time > lastTime + 0.1) {
      lastTime = current.time;
      lastProgressAt = Date.now();
    } else if (Date.now() - lastProgressAt > 60000) {
      throw new Error('视频超过 60 秒未继续播放，已保留此前采集的音频。');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function startAudioRecorder(s, start) {
  const chunks = [];
  const recorder = new MediaRecorder(s.stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 64000,
  });
  const entry = { recorder, start };
  entry.blob = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = (event) => reject(event.error || new Error('音频录制失败'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
  });
  s.recorders.add(entry);
  recorder.start();
  return entry;
}

async function saveAudioRecorder(s, entry) {
  if (entry.recorder.state !== 'inactive') entry.recorder.stop();
  const blob = await entry.blob;
  s.recorders.delete(entry);
  const endState = await position(s).catch(() => null);
  const end = Math.min(s.plan[0].end, Number(endState?.time) || entry.start);
  if (blob.size < 1000 || end <= entry.start + 0.1) return;
  await saveAudio({
    videoKey: s.videoKey,
    recordId: s.recordId,
    segmentId: crypto.randomUUID(),
    start: entry.start,
    end,
    blob,
  });
  const reply = await send({
    type: 'ASR_CHUNK',
    recordId: s.recordId,
    segmentId: s.plan[0].id,
    capturedEnd: end,
    segments: [],
    completed: ++s.completed,
  });
  if (!reply?.ok) throw new Error(reply?.error || '本地音频保存失败');
}

async function recordAudioOnly(s) {
  s.recorders = new Set();
  let current = null;
  try {
    const initial = await waitForAudioTime(s, s.plan[0].start);
    if (!initial) return;
    current = startAudioRecorder(s, initial.time);
    const duration = s.plan[0].end;
    let boundary = Math.min(duration, initial.time + 10);
    while (!s.stopping && boundary < duration - 0.2) {
      const overlap = await waitForAudioTime(s, boundary - 1);
      if (!overlap) break;
      const next = startAudioRecorder(s, overlap.time);
      const boundaryState = await waitForAudioTime(s, boundary);
      await saveAudioRecorder(s, current);
      current = next;
      if (!boundaryState) break;
      boundary = Math.min(duration, boundary + 120);
    }
    if (!s.stopping) await waitForAudioTime(s, duration - 0.15);
  } catch (error) {
    if (!s.controller.signal.aborted) s.errors.push(error.message);
    s.stopping = true;
  } finally {
    for (const entry of [...s.recorders]) {
      try {
        await saveAudioRecorder(s, entry);
      } catch (error) {
        if (!s.controller.signal.aborted) s.errors.push(error.message);
      }
    }
    s.stopping = true;
    await finish(s);
  }
}
async function recordChunk(s) {
  if (s.stopping) return finish(s);
  try {
    const segment = s.plan[s.nextIndex];
    if (!segment) return stop(s);
    let current = await position(s);
    const readyDeadline = Date.now() + 20000;
    while (true) {
      if (s.stopping) return finish(s);
      if (current.mediaErrorCode || current.unavailable)
        throw new Error('播放器报告媒体错误，音频采集已停止；此前完成的字幕已保留。');
      if (
        !current.paused &&
        !current.seeking &&
        (current.readyState == null || current.readyState >= 2)
      )
        break;
      if (Date.now() >= readyDeadline)
        throw new Error(
          current.paused
            ? '视频仍处于暂停状态，尚未采集该段音频；请恢复播放后重试。'
            : '等待音频缓冲超时（20 秒）；此前完成的字幕已保留。',
        );
      await new Promise((resolve) => setTimeout(resolve, 120));
      current = await position(s);
    }
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
      // Persist the captured clip before attempting ASR. A provider timeout or
      // malformed response must not throw away the only copy of the audio.
      if (blob.size >= 1000) {
        const saved = endPosition.then(async (endState) => {
          const end = Math.min(
            segment.end,
            Math.max(offset + 0.1, Number(endState?.time) || segment.end),
          );
          await saveAudio({
            videoKey: s.videoKey,
            recordId: s.recordId,
            segmentId: segment.id,
            start: offset,
            end,
            blob,
          });
          return end;
        });
        // Attach a handler immediately while a previous ASR request is running.
        saved.catch(() => {});
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
            const capturedEnd = await saved;
            if (s.controller.signal.aborted || s.failed) return;
            // `discard` means only that this clip must not be submitted to ASR
            // (for example after a recorder error); it is still available for
            // a later local retry.
            if (discard) return;
            // A truly silent clip has no words to send to ASR. Ambient sound
            // above this tiny threshold still goes to the model for a decision.
            if (s.audioOnly || (samples && audioLevel < 0.004)) {
              const reply = await send({
                type: 'ASR_CHUNK',
                recordId: s.recordId,
                segmentId: segment.id,
                capturedEnd,
                segments: [],
                completed: s.completed + 1,
              });
              if (!reply?.ok) throw new Error(reply?.error || '静音段保存失败');
              s.completed++;
              return;
            }
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
  if (s.audioOnly && s.audioOnlyRun) return;
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
    if (session.audioOnly) {
      session.audioOnlyRun = recordAudioOnly(session);
      reply({ ok: true });
      return;
    }
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
