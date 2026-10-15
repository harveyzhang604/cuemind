import { laserPointerRegions } from '../core/frame-changes.js';

// This function is serialized by chrome.scripting; keep it self contained.
export async function readVideoFrame(expectedKey) {
  const u = new URL(location.href);
  const youtube = u.hostname === 'www.youtube.com' && u.pathname === '/watch';
  const bilibili = u.hostname === 'www.bilibili.com';
  const id = youtube
    ? u.searchParams.get('v')
    : bilibili
      ? u.pathname.match(/^\/video\/(BV\w+)/)?.[1]
      : null;
  const key = id
    ? `${youtube ? 'youtube' : 'bilibili'}:${id}:${youtube ? 1 : Number(u.searchParams.get('p') || 1)}`
    : null;
  if (!key || key !== expectedKey) throw new Error('视频已切换，画面提取已停止');
  if (document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting'))
    throw new Error('正在播放广告，请等待正片后再提取');
  const video = [...document.querySelectorAll('video')]
    .filter((v) => v.getBoundingClientRect().width > 10)
    .sort(
      (a, b) =>
        b.getBoundingClientRect().width * b.getBoundingClientRect().height -
        a.getBoundingClientRect().width * a.getBoundingClientRect().height,
    )[0];
  if (!video || video.error) throw new Error('视频画面暂不可读取');
  if (video.seeking || video.readyState < 2 || !video.videoWidth) return { buffering: true };
  const rect = video.getBoundingClientRect();
  const scale = Math.min(1, 2560 / video.videoWidth, 1440 / video.videoHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  let image;
  try {
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    image = canvas.toDataURL('image/jpeg', 0.94);
  } catch (error) {
    if (error.name !== 'SecurityError') throw error;
    // Some CDNs omit CORS. The caller can crop a visible-tab screenshot instead.
  }
  return {
    image,
    time: video.currentTime,
    ended: video.ended,
    paused: video.paused,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: { width: innerWidth, height: innerHeight },
  };
}

export async function framePixels(image) {
  const bitmap = await createImageBitmap(await (await fetch(image)).blob());
  try {
    const canvas = new OffscreenCanvas(640, 360),
      context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, 640, 360);
    const rgba = context.getImageData(0, 0, 640, 360).data;
    return frameSignature(rgba);
  } finally {
    bitmap.close();
  }
}

export function frameSignature(rgba) {
  const pixels = new Uint8Array(640 * 360);
  for (let i = 0; i < pixels.length; i++)
    pixels[i] = Math.round(rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114);
  // Suppress single-pixel codec ringing at text edges without discarding a
  // genuine changed character. Raw pixels are still used for laser colour.
  const signature = pixels.slice();
  for (let y = 1; y < 359; y++)
    for (let x = 1; x < 639; x++) {
      const i = y * 640 + x;
      signature[i] = Math.round(
        (pixels[i - 641] +
          2 * pixels[i - 640] +
          pixels[i - 639] +
          2 * pixels[i - 1] +
          4 * pixels[i] +
          2 * pixels[i + 1] +
          pixels[i + 639] +
          2 * pixels[i + 640] +
          pixels[i + 641]) /
          16,
      );
    }
  return {
    signature,
    pointerRegions: laserPointerRegions(rgba, 640, 360),
    blank: signature.every((v) => v <= 5) || signature.every((v) => v >= 250),
  };
}

export async function unpackFrameSignature(encoded) {
  const compressed = await (await fetch('data:application/octet-stream;base64,' + encoded)).blob();
  const signature = new Uint8Array(
    await new Response(
      compressed.stream().pipeThrough(new DecompressionStream('deflate')),
    ).arrayBuffer(),
  );
  if (signature.length !== 640 * 360) throw new Error('后台画面特征无效');
  return signature;
}

export function hideMaterialOverlays(hidden) {
  const id = 'cuemind-materials-capture-style';
  document.getElementById(id)?.remove();
  if (hidden) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '#cuemind-tools,#cuemind-focus-captions{visibility:hidden!important}';
    document.documentElement.append(style);
  }
}

export async function cropVideoScreenshot(image, rect, viewport) {
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width < 32 ||
    rect.height < 32 ||
    rect.x + rect.width > viewport.width + 1 ||
    rect.y + rect.height > viewport.height + 1
  )
    throw new Error('请把完整的视频画面滚动到窗口内，避免截取不完整的代码。');
  const bitmap = await createImageBitmap(await (await fetch(image)).blob());
  try {
    const sx = bitmap.width / viewport.width,
      sy = bitmap.height / viewport.height;
    const width = Math.round(rect.width * sx),
      height = Math.round(rect.height * sy);
    const scale = Math.min(1, 2560 / width, 1440 / height);
    const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
    canvas
      .getContext('2d')
      .drawImage(
        bitmap,
        rect.x * sx,
        rect.y * sy,
        width,
        height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.94 })).arrayBuffer(),
    );
    let encoded = '';
    for (let i = 0; i < bytes.length; i += 8192)
      encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return 'data:image/jpeg;base64,' + btoa(encoded);
  } finally {
    bitmap.close();
  }
}

// Serialized into a task-owned inactive platform tab. It never plays the video
// or activates the tab; the site's player resolves its own protected media URL.
export async function seekBackgroundFrame(expectedKey, time) {
  const key = () => {
    const u = new URL(location.href),
      yt = u.hostname === 'www.youtube.com';
    return `${yt ? 'youtube' : 'bilibili'}:${yt ? u.searchParams.get('v') : u.pathname.match(/^\/video\/(BV\w+)/)?.[1]}:${yt ? 1 : Number(u.searchParams.get('p') || 1)}`;
  };
  if (key() !== expectedKey) throw new Error('后台视频已切换');
  if (document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting'))
    throw new Error('后台视频正在加载广告，请稍后重试');
  const video = [...document.querySelectorAll('video')]
    .filter((v) => v.getBoundingClientRect().width > 10)
    .sort((a, b) => b.videoWidth - a.videoWidth)[0];
  if (!video || video.error) throw new Error('后台页面的视频尚未加载');
  video.muted = true;
  video.pause();
  const target = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05));
  if (!Number.isFinite(target)) throw new Error('后台视频时长未加载');
  if (Math.abs(video.currentTime - target) > 0.005) video.currentTime = target;
  await new Promise((resolve, reject) => {
    const events = ['seeked', 'loadeddata', 'canplay'];
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const event of events) video.removeEventListener(event, check);
      video.removeEventListener('error', failed);
      error ? reject(error) : resolve();
    };
    const check = () => {
        if (!video.seeking && video.readyState >= 2) finish();
      },
      failed = () => finish(new Error('后台视频定位失败'));
    const timer = setTimeout(() => finish(new Error('后台视频定位超时，已保留已完成内容')), 20000);
    for (const event of events) video.addEventListener(event, check);
    video.addEventListener('error', failed, { once: true });
    check();
  });
  if (key() !== expectedKey || Math.abs(video.currentTime - target) > 0.15)
    throw new Error('后台视频定位不符，未保存错误截图');
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  canvas.getContext('2d').drawImage(video, 0, 0, 640, 360);
  let preview;
  try {
    preview = canvas.toDataURL('image/png');
  } catch {
    throw new Error('平台限制后台读取画面，未启动前台播放。');
  }
  return { preview, time: video.currentTime, duration: video.duration, paused: video.paused };
}

// Bootstrap MSE players only in a task-owned muted background tab. Playback
// stops as soon as the native player exposes its first decodable frame.
export function primeBackgroundVideo() {
  const video = [...document.querySelectorAll('video')].find(
    (v) => v.getBoundingClientRect().width > 10,
  );
  if (!video) return;
  video.muted = true;
  if (video.readyState < 2) {
    const native = document.getElementById('movie_player');
    native?.mute?.();
    native?.playVideo?.();
    video.play().catch(() => {});
  }
}
