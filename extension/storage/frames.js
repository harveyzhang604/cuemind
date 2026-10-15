import { db, get, put } from './db.js';

export async function saveMaterialFrame({ recordId, videoKey, time, hash, image }) {
  if (
    typeof image !== 'string' ||
    image.length > 6_000_000 ||
    !image.startsWith('data:image/jpeg;base64,') ||
    !Number.isFinite(time) ||
    time < 0 ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    throw new Error('视频截图格式无效');
  const id = `${recordId}:${hash}`;
  if (await get('frames', id)) return id;
  const blob = await (await fetch(image)).blob();
  if (!blob.size) throw new Error('视频截图为空，未保存');
  await put('frames', {
    id,
    recordId,
    videoKey,
    time,
    hash,
    blob,
    bytes: blob.size,
    mimeType: 'image/jpeg',
  });
  return id;
}

export async function materialFrames(recordId) {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const rows = [],
      transaction = connection.transaction('frames');
    const cursor = transaction
      .objectStore('frames')
      .index('recordId')
      .openCursor(IDBKeyRange.only(recordId));
    cursor.onsuccess = () => {
      const value = cursor.result;
      if (!value) return;
      const { blob, ...metadata } = value.value;
      rows.push(metadata);
      value.continue();
    };
    transaction.oncomplete = () => resolve(rows.sort((a, b) => a.time - b.time));
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('读取本地截图已中断'));
  });
}

export async function materialFrameData(recordId, id) {
  const frame = await get('frames', id);
  if (!frame || frame.recordId !== recordId)
    throw new Error('本地截图不存在，旧版本未保存的截图需重新提取。');
  const bytes = new Uint8Array(await frame.blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { time: frame.time, dataUrl: 'data:image/jpeg;base64,' + btoa(binary) };
}
