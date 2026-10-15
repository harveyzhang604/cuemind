import { materialImages, materialFrameGroups } from './material-content.js';
import { materialsMarkdown, mergeMaterialFrames } from './materials.js';
import { formatTime, timestampUrl } from './transcript.js';

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

// JPEGs are already compressed. ZIP STORE keeps packaging offline and avoids
// a remote dependency or loading a compression library into the extension.
export function materialsZip(files) {
  if (files.length > 5000 || new Set(files.map((file) => file.path)).size !== files.length)
    throw new Error('打包文件数量或名称无效');
  const encoder = new TextEncoder(),
    chunks = [],
    directory = [];
  let offset = 0,
    bytes = 0;
  for (const file of files) {
    if (
      !file.path ||
      file.path.startsWith('/') ||
      /\\|[\u0000-\u001f]/.test(file.path) ||
      file.path.split('/').some((part) => !part || part === '..' || part === '.')
    )
      throw new Error('打包文件路径无效');
    const name = encoder.encode(file.path),
      data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    if (!(data instanceof Uint8Array) || name.length > 65535) throw new Error('打包内容无效');
    bytes += data.length;
    if (bytes > 250_000_000) throw new Error('截图包超过 250 MB，请先分批保存截图。');
    const checksum = crc32(data),
      local = new Uint8Array(30),
      header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x800, true);
    header.setUint16(12, 0x2821, true);
    header.setUint32(14, checksum, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);
    const central = new Uint8Array(46),
      entry = new DataView(central.buffer);
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x800, true);
    entry.setUint16(14, 0x2821, true);
    entry.setUint32(16, checksum, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    chunks.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const end = new Uint8Array(22),
    header = new DataView(end.buffer);
  header.setUint32(0, 0x06054b50, true);
  header.setUint16(8, files.length, true);
  header.setUint16(10, files.length, true);
  header.setUint32(
    12,
    directory.reduce((sum, part) => sum + part.length, 0),
    true,
  );
  header.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end], { type: 'application/zip' });
}

export async function materialsPackage(record, images, loadImage, { allImages = false } = {}) {
  const originalImageCount = images.length;
  images = materialImages(record.videoMaterials, images, allImages);
  const { byImage } = materialFrameGroups(record.videoMaterials?.frames || []);
  if (!images.length) throw new Error('本地尚无截图。旧版本的提取结果需要重新提取才能补齐截图。');
  if (images.reduce((sum, image) => sum + image.bytes, 0) > 240_000_000)
    throw new Error('本地截图超过 240 MB，请先逐张保存截图。');
  const files = [],
    manifest = [];
  for (const [index, image] of images.entries()) {
    const path = `screenshots/${String(index + 1).padStart(4, '0')}-${formatTime(image.time).replace(/:/g, '-')}.jpg`;
    const data = await loadImage(image.id);
    const bytes = new Uint8Array(await (await fetch(data.dataUrl)).arrayBuffer());
    files.push({ path, data: bytes });
    manifest.push({
      ...image,
      path,
      times: byImage.get(image.id)?.frames.map((frame) => frame.time) || [image.time],
    });
  }
  let text = record.videoMaterials?.frames?.some((frame) => frame.items.length)
    ? materialsMarkdown(record)
    : `# ${record.videoInfo.title}\n\n尚未完成文字识别，原始截图已保存。\n`;
  text += `\n## ${allImages ? '全部原始截图' : '按内容去重的原始截图'}\n\n共保存 ${originalImageCount} 张原始截图，本包包含 ${images.length} 张；同一内容的出现时间保留在 JSON 中。\n\n`;
  for (const image of manifest)
    text += `### [${formatTime(image.time)}](${timestampUrl(record.videoInfo, image.time)})\n\n![${formatTime(image.time)}](${image.path})\n\n`;
  files.unshift(
    { path: 'materials.md', data: text },
    {
      path: 'materials.json',
      data: JSON.stringify(
        {
          format: 'cuemind-materials',
          version: 1,
          videoInfo: record.videoInfo,
          ...record.videoMaterials,
          images: manifest,
          contents: mergeMaterialFrames(record.videoMaterials?.frames || []),
          originalImageCount,
          allImages,
        },
        null,
        2,
      ),
    },
  );
  if (
    record.videoMaterials?.frames?.some((frame) => frame.items.some((item) => item.kind === 'code'))
  )
    files.push({ path: 'code.md', data: materialsMarkdown(record, true) });
  return materialsZip(files);
}
