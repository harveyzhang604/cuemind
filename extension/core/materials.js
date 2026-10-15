import { formatTime, timestampUrl } from './transcript.js';
import { materialItemKey } from './material-content.js';
import { frameChanges, updateFrameRegions, backgroundDistance } from './frame-changes.js';

export const MATERIALS_MODEL = 'deepseek-flash';
export const MATERIALS_VERSION = 1;

export function materialOptions(duration, options = {}) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
    throw new Error('请等待视频时长加载完成；暂不支持直播画面提取。');
  if (!['beginning', 'all', 'remaining', 'current'].includes(options.mode))
    throw new Error('请选择从开头到结尾、继续提取、从当前播放位置或当前画面。');
  return { mode: options.mode, duration };
}

export function differentFrame(a, b, width = 640, ignored = []) {
  return frameChanges(a, b, width, ignored).pixels >= 4;
}

export class MaterialSceneDetector {
  baseline = null;
  candidate = null;
  previous = null;
  pointerRegions = [];
  carets = [];
  changedAt = 0;
  stable = 0;
  consider(frame, force = false) {
    if (frame.blank) return false;
    const signature = frame.signature;
    if (!signature?.length) throw new Error('无法分析视频画面');
    const pointers = frame.pointerRegions || [];
    if (!this.baseline) {
      this.baseline = signature.slice();
      this.previous = signature;
      this.pointerRegions = pointers;
      return true;
    }
    // Match moving overlays between consecutive observations, independent of
    // the last accepted page. This also learns a pointer entering a clean slide.
    const motion = frameChanges(this.previous, signature, 640, [
      ...this.pointerRegions,
      ...pointers,
    ]);
    for (const r of motion.regions || []) {
      if (r.width > 3 || r.height < 8 || r.height > 30 || r.count / (r.width * r.height) < 0.6)
        continue;
      const sign = r.positive / r.count > 0.9 ? 1 : r.positive / r.count < 0.1 ? -1 : 0;
      if (!sign) continue;
      let caret = this.carets.find(
        (c) =>
          Math.abs(c.x - r.x) < 3 && Math.abs(c.y - r.y) < 3 && Math.abs(c.height - r.height) < 3,
      );
      if (!caret) {
        caret = { ...r, sign, seenAt: frame.time, until: -1 };
        this.carets.push(caret);
      } else {
        if (caret.sign !== sign && frame.time - caret.seenAt < 1.8) {
          const clean =
            backgroundDistance(signature, r) < backgroundDistance(this.previous, r)
              ? signature
              : this.previous;
          updateFrameRegions(this.baseline, clean, [r]);
          caret.until = frame.time + 5;
        }
        caret.sign = sign;
        caret.seenAt = frame.time;
      }
    }
    this.carets = this.carets.filter((c) => frame.time - c.seenAt < 10).slice(-32);
    const blinking = this.carets
      .filter((c) => c.until >= frame.time)
      .map((c) => ({ ...c, transient: 'caret' }));
    const change = frameChanges(this.baseline, signature, 640, [...motion.ignored, ...blinking]);
    updateFrameRegions(this.baseline, signature, change.ignored);
    updateFrameRegions(this.candidate, signature, change.ignored);
    this.previous = signature;
    this.pointerRegions = pointers;
    if (change.pixels < 4) {
      this.candidate = null;
      this.stable = 0;
      return false;
    }
    if (!this.candidate) this.changedAt = frame.time;
    this.stable =
      this.candidate && !differentFrame(this.candidate, signature, 640, change.ignored)
        ? this.stable + 1
        : 0;
    this.candidate = signature.slice();
    // Wait for a settled slide, but retain intermediate views during a long
    // scroll so a whole screen of code is not lost while the lecturer scrolls.
    if (!force) {
      if (change.broad) {
        if (this.stable < 1 && frame.time - this.changedAt < 2) return false;
      } else if (this.stable < 2 || frame.time - this.changedAt < 1.2 - 0.0001) return false;
    }
    this.baseline = signature.slice();
    this.candidate = null;
    this.stable = 0;
    return true;
  }
}

export function normalizeMaterialItems(result) {
  if (!result || !Array.isArray(result.items) || result.items.length > 40)
    throw new Error('画面识别结果格式无效，未保存本画面，可重试。');
  let length = 0;
  return result.items.map((item) => {
    if (
      !item ||
      !['code', 'slide'].includes(item.kind) ||
      typeof item.content !== 'string' ||
      !item.content.trim() ||
      item.content.length > 30000 ||
      typeof item.title !== 'string' ||
      item.title.length > 200 ||
      typeof item.language !== 'string' ||
      !/^[a-zA-Z0-9_+.#-]{0,30}$/.test(item.language) ||
      typeof item.partial !== 'boolean' ||
      !Array.isArray(item.uncertainties) ||
      item.uncertainties.length > 30 ||
      item.uncertainties.some((value) => typeof value !== 'string' || value.length > 500)
    )
      throw new Error('画面代码或课件内容格式无效，未保存本画面，可重试。');
    length += item.content.length;
    if (length > 120000) throw new Error('单个画面识别内容过长');
    return {
      kind: item.kind,
      title: item.title.trim(),
      language: item.language.toLowerCase(),
      content: item.content
        .replace(/\r\n?/g, '\n')
        .replace(/[\t ]+$/gm, '')
        .replace(/^\n+|\n+$/g, ''),
      partial: item.partial,
      uncertainties: item.uncertainties,
    };
  });
}

export function mergeMaterialFrames(frames = []) {
  const merged = new Map();
  for (const frame of [...frames].sort((a, b) => a.time - b.time)) {
    for (const item of normalizeMaterialItems({ items: frame.items })) {
      const key = materialItemKey(item);
      const previous = merged.get(key);
      if (previous) {
        previous.times = [...new Set([...previous.times, frame.time])];
        previous.partial ||= item.partial;
        previous.uncertainties = [...new Set([...previous.uncertainties, ...item.uncertainties])];
      } else merged.set(key, { ...item, times: [frame.time] });
    }
  }
  const result = [];
  for (const item of merged.values()) {
    let joined = false;
    for (const previous of [...result].reverse()) {
      if (
        previous?.kind === 'code' &&
        item.kind === 'code' &&
        previous.language === item.language &&
        item.times[0] - previous.times.at(-1) < 45
      ) {
        const a = previous.content.split('\n'),
          b = item.content.split('\n');
        // Join scrolling windows only on a substantial, byte-for-byte matching
        // anchor. Similar but edited lines remain separate versions.
        const meaningful = (lines) =>
          lines.filter((line) => /[\p{L}\p{N}]/u.test(line)).length >= 3 &&
          lines.join('\n').length >= 80;
        let combined;
        if (meaningful(b) && previous.content.includes(item.content)) combined = previous.content;
        else if (meaningful(a) && item.content.includes(previous.content)) combined = item.content;
        else
          for (let size = Math.min(a.length, b.length); size >= 3; size--) {
            const overlap = a.slice(-size);
            if (meaningful(overlap) && overlap.join('\n') === b.slice(0, size).join('\n')) {
              combined = [...a, ...b.slice(size)].join('\n');
              break;
            }
          }
        if (combined) {
          previous.content = combined;
          previous.times = [...new Set([...previous.times, ...item.times])].sort((a, b) => a - b);
          previous.partial ||= item.partial;
          previous.uncertainties = [...new Set([...previous.uncertainties, ...item.uncertainties])];
          joined = true;
          break;
        }
      }
    }
    if (joined) continue;
    result.push(item);
  }
  return result;
}

export function validateMaterials(data) {
  if (
    !data ||
    data.version !== MATERIALS_VERSION ||
    data.model !== MATERIALS_MODEL ||
    !Array.isArray(data.frames) ||
    data.frames.length > 1500 ||
    JSON.stringify(data).length > 4_000_000
  )
    throw new Error('视频课件数据格式或大小无效');
  for (const frame of data.frames) {
    if (
      !Number.isFinite(frame.time) ||
      frame.time < 0 ||
      typeof frame.hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(frame.hash)
    )
      throw new Error('课件画面时间或标识无效');
    normalizeMaterialItems({ items: frame.items });
    if (frame.blank !== undefined && typeof frame.blank !== 'boolean')
      throw new Error('课件画面标记无效');
    if (
      frame.imageId !== undefined &&
      (typeof frame.imageId !== 'string' || frame.imageId.length > 600)
    )
      throw new Error('课件截图标识无效');
  }
  return data;
}

export function materialsMarkdown(record, codeOnly = false) {
  const data = validateMaterials(record.videoMaterials);
  const items = mergeMaterialFrames(data.frames).filter(
    (item) => !codeOnly || item.kind === 'code',
  );
  if (!items.length) throw new Error(codeOnly ? '尚未提取到代码' : '尚未提取到代码或课件文字');
  const title = String(record.videoInfo.title || '').replace(/[\r\n]/g, ' ');
  const lines = [
    `# ${title} · ${codeOnly ? '代码' : '视频代码与课件'}`,
    '',
    `来源：${record.videoInfo.url}`,
    `识别模型：${MATERIALS_MODEL}`,
    '',
    '> 以下为视频画面的识别稿，不是讲师发布的源文件。只保留可见内容；滚动、遮挡或模糊处可能不完整，请按时间点核对。',
    '',
  ];
  if (data.run?.status !== 'done') lines.push('> 提取尚未完成，以下为已保存的部分内容。', '');
  if (!['beginning', 'all'].includes(data.run?.scope))
    lines.push('> 最近一次仅提取当前画面或当前位置之后的内容，不能据此判断已覆盖全片。', '');
  for (const item of items) {
    lines.push(
      `## ${formatTime(item.times[0])} · ${item.title || (item.kind === 'code' ? '代码片段' : '课件文字')}`,
      '',
      item.times
        .map((time) => `[${formatTime(time)}](${timestampUrl(record.videoInfo, time)})`)
        .join(' · '),
      '',
    );
    if (item.partial) lines.push('> 本片段在画面中未完整显示。', '');
    for (const issue of item.uncertainties)
      lines.push(`> 待核对：${issue.replace(/[\r\n]/g, ' ')}`);
    const fence = '`'.repeat(
      Math.max(3, ...[...item.content.matchAll(/`+/g)].map((m) => m[0].length + 1)),
    );
    lines.push(`${fence}${item.kind === 'code' ? item.language : 'text'}`, item.content, fence, '');
  }
  return lines.join('\n');
}
