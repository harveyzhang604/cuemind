import { frameSignature } from '../services/video-frames.js';

// Independent, silent decoding. No webpage player is played, sought or locked.
let session = null;
const limit = 512_000_000;
const abortError = () => new DOMException('已停止后台提取', 'AbortError');
function close(token) {
  if (!session || session.token !== token) return;
  session.controller.abort();
  for (const video of session.lanes || [session.video]) {
    video?.pause();
    video?.removeAttribute('src');
    video?.load();
    video?.remove();
  }
  for (const picture of session.snapshots?.values() || []) picture.bitmap.close();
  if (session.url) URL.revokeObjectURL(session.url);
  session = null;
}
function waitVideo(video, test, signal, timeout = 20000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const events = ['seeked', 'loadeddata', 'canplay', 'durationchange'];
    const finish = (error) => {
      if (settled) return;
      settled = true;
      for (const event of events) video.removeEventListener(event, check);
      clearTimeout(timer);
      clearInterval(poll);
      signal.removeEventListener('abort', cancel);
      video.removeEventListener('error', failed);
      error ? reject(error) : resolve();
    };
    const check = () => {
      if (test()) finish();
    };
    const cancel = () => finish(abortError()),
      failed = () => finish(new Error('后台视频解码失败，请稍后重试或检查视频是否可访问。'));
    const timer = setTimeout(
        () => finish(new Error('后台视频解码超时，已保留完成的截图。')),
        timeout,
      ),
      poll = setInterval(check, 20);
    signal.addEventListener('abort', cancel, { once: true });
    video.addEventListener('error', failed, { once: true });
    for (const event of events) video.addEventListener(event, check);
    if (signal.aborted) cancel();
    else if (video.error) failed();
    else check();
  });
}
async function open(m) {
  if (session) throw new Error('已有后台视频正在处理');
  const s = { token: m.token, controller: new AbortController() };
  session = s;
  const signal = s.controller.signal,
    deadline = Date.now() + 180000;
  try {
    let failure;
    for (const source of m.sources) {
      if (signal.aborted) throw abortError();
      if (Date.now() >= deadline) throw new Error('后台视频下载超时，请稍后重试');
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      if (
        !video.canPlayType(source.mimeType + (source.codecs ? `; codecs="${source.codecs}"` : ''))
      )
        continue;
      s.video = video;
      document.body.append(video);
      try {
        // One bounded download avoids hundreds of remote range seeks and CORS-
        // tainted canvases. Bytes are released when the job finishes or stops.
        const requestSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(Math.max(1, Math.min(120000, deadline - Date.now()))),
        ]);
        const response = await fetch(source.url, { signal: requestSignal, credentials: 'omit' });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`后台视频下载失败（HTTP ${response.status}）`);
        }
        if (Number(response.headers.get('content-length')) > limit) {
          await response.body?.cancel();
          throw new Error('视频文件超过 512 MB，正在尝试其他清晰度');
        }
        const reader = response.body.getReader(),
          parts = [];
        let received = 0,
          lastReport = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            received += value.length;
            if (received > limit) throw new Error('视频文件超过 512 MB，正在尝试其他清晰度');
            parts.push(value);
            if (Date.now() - lastReport > 400) {
              lastReport = Date.now();
              chrome.runtime
                .sendMessage({
                  type: 'MATERIALS_DOWNLOAD_PROGRESS',
                  token: s.token,
                  received,
                  total: Number(response.headers.get('content-length')) || 0,
                })
                .catch(() => {});
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        if (signal.aborted) throw abortError();
        s.url = URL.createObjectURL(new Blob(parts, { type: source.mimeType }));
        parts.length = 0;
        video.src = s.url;
        video.load();
        await waitVideo(video, () => video.readyState >= 2, signal);
        if (!Number.isFinite(video.duration)) {
          video.currentTime = 1e9;
          await waitVideo(video, () => Number.isFinite(video.duration) && !video.seeking, signal);
        }
        if (!Number.isFinite(video.duration) || video.duration <= 0)
          throw new Error('后台视频时长无效');
        if (Math.abs(video.duration - m.duration) > Math.max(2, m.duration * 0.02))
          throw new Error('后台视频时长与当前分 P 不符，未提取错误的视频');
        s.lanes = [video];
        s.snapshots = new Map();
        const extra = document.createElement('video');
        extra.muted = true;
        extra.preload = 'auto';
        extra.src = s.url;
        document.body.append(extra);
        try {
          await waitVideo(extra, () => extra.readyState >= 2, signal);
          s.lanes.push(extra);
        } catch (error) {
          extra.removeAttribute('src');
          extra.load();
          extra.remove();
          if (signal.aborted) throw error;
        }
        return {
          lanes: s.lanes.length,
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          bytes: received,
        };
      } catch (error) {
        failure = error;
        video.removeAttribute('src');
        video.load();
        video.remove();
        s.video = null;
        if (s.url) {
          URL.revokeObjectURL(s.url);
          s.url = null;
        }
        if (signal.aborted) throw abortError();
      }
    }
    throw failure || new Error('Chrome 暂不支持该视频编码，未启动前台播放。');
  } catch (error) {
    close(s.token);
    throw error;
  }
}
async function read(m) {
  const s = session;
  if (!s || s.token !== m.token || !s.video) throw new Error('后台视频任务已结束');
  const video = s.lanes?.[m.lane || 0] || s.video,
    time = Math.min(Math.max(0, m.time), Math.max(0, video.duration - 0.05));
  if (!Number.isFinite(time)) throw new Error('画面时间无效');
  if (Math.abs(video.currentTime - time) > 0.005) video.currentTime = time;
  await waitVideo(video, () => !video.seeking && video.readyState >= 2, s.controller.signal);
  if (Math.abs(video.currentTime - time) > 0.15)
    throw new Error('后台定位未完成，未保存错误时间的截图');
  if (!m.keep) {
    for (const picture of s.snapshots.values()) picture.bitmap.close();
    s.snapshots.clear();
  }
  const bitmap = await createImageBitmap(video);
  if (s.controller.signal.aborted) {
    bitmap.close();
    throw abortError();
  }
  const frameId = crypto.randomUUID();
  s.snapshots.set(frameId, { bitmap, time: video.currentTime });
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, 640, 360);
  const { signature, pointerRegions, blank } = frameSignature(
    context.getImageData(0, 0, 640, 360).data,
  );
  const compressed = new Uint8Array(
    await new Response(
      new Blob([signature]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  );
  let binary = '';
  for (let i = 0; i < compressed.length; i += 8192)
    binary += String.fromCharCode(...compressed.subarray(i, i + 8192));
  return {
    time: video.currentTime,
    frameId,
    signature: btoa(binary),
    pointerRegions,
    blank,
    paused: true,
  };
}
async function batch(m) {
  const s = session;
  if (!s || s.token !== m.token) throw new Error('后台视频任务已结束');
  if (!Array.isArray(m.times) || !m.times.length || m.times.length > s.lanes.length)
    throw new Error('后台画面队列无效');
  for (const picture of s.snapshots.values()) picture.bitmap.close();
  s.snapshots.clear();
  return Promise.all(m.times.map((time, lane) => read({ ...m, time, lane, keep: true })));
}
function snapshot(m) {
  const s = session;
  const picture =
    s?.token === m.token
      ? s.snapshots.get(m.frameId) ||
        [...s.snapshots.values()].find((p) => Math.abs(p.time - m.time) < 0.005)
      : null;
  if (!picture || Math.abs(picture.time - m.time) > 0.15)
    throw new Error('后台截图时间不符，未保存错误画面');
  const bitmap = picture.bitmap,
    scale = Math.min(1, 2560 / bitmap.width, 1440 / bitmap.height),
    canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { time: picture.time, image: canvas.toDataURL('image/jpeg', 0.94) };
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (
    m?.target !== 'offscreen' ||
    !m.type?.startsWith('MATERIALS_') ||
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL('background.js')
  )
    return;
  const action =
    m.type === 'MATERIALS_OPEN'
      ? () => open(m)
      : m.type === 'MATERIALS_BATCH'
        ? () => batch(m)
        : m.type === 'MATERIALS_READ'
          ? () => read(m)
          : m.type === 'MATERIALS_SNAPSHOT'
            ? () => snapshot(m)
            : m.type === 'MATERIALS_CLOSE'
              ? () => close(m.token)
              : null;
  if (!action) return;
  Promise.resolve()
    .then(action)
    .then((data) => reply({ ok: true, data }))
    .catch((e) => reply({ ok: false, error: e.message }));
  return true;
});
