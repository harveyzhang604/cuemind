import { db, put, get } from './db.js';
export async function saveAudio({ videoKey, recordId, segmentId, start, end, blob }) {
  if (
    !videoKey ||
    !recordId ||
    !(blob instanceof Blob) ||
    !blob.size ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  )
    throw new Error('本地音频片段无效');
  const clip = {
    id: `${recordId}:${segmentId || crypto.randomUUID()}`,
    videoKey,
    recordId,
    segmentId,
    start,
    end,
    blob,
    bytes: blob.size,
    mimeType: blob.type,
    savedAt: Date.now(),
  };
  await put('audio', clip);
  return clip;
}
export const getAudio = (id) => get('audio', id);
// Read metadata only into memory; do not load hours of blobs for the library.
export async function audioClips(videoKey) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('audio'),
      rows = [];
    const q = t.objectStore('audio').openCursor();
    q.onsuccess = () => {
      const c = q.result;
      if (!c) return;
      const { blob, ...meta } = c.value;
      if (!videoKey || meta.videoKey === videoKey) rows.push(meta);
      c.continue();
    };
    t.oncomplete = () => resolve(rows.sort((a, b) => a.start - b.start));
    t.onerror = () => reject(t.error);
  });
}
export async function deleteAudio(videoKey) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('audio', 'readwrite');
    const q = t.objectStore('audio').openCursor();
    q.onsuccess = () => {
      const c = q.result;
      if (!c) return;
      if (c.value.videoKey === videoKey) c.delete();
      c.continue();
    };
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
export function audioCoverage(clips) {
  const ranges = [];
  for (const c of [...clips].sort((a, b) => a.start - b.start)) {
    const last = ranges.at(-1);
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else ranges.push({ start: c.start, end: c.end });
  }
  return {
    seconds: ranges.reduce((n, r) => n + r.end - r.start, 0),
    bytes: clips.reduce((n, c) => n + c.bytes, 0),
    ranges,
  };
}
