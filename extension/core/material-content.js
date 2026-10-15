// Identity is based on transcribed content, never on OCR titles or screenshot
// colours. Preserve identifiers, operators, literals and Python indentation.
export function pythonContentKey(content) {
  const tokens = [];
  let i = 0,
    depth = 0,
    lineStart = true;
  while (i < content.length) {
    if (lineStart) {
      const start = i;
      while (/[ \t]/.test(content[i] || '') && i < content.length) i++;
      if (content[i] === '\n') {
        i++;
        continue;
      }
      if (i >= content.length) break;
      if (!depth) tokens.push(['indent', content.slice(start, i)]);
      lineStart = false;
    }
    if (i >= content.length) break;
    const c = content[i];
    if (c === '\n') {
      if (!depth) tokens.push(['newline']);
      i++;
      lineStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#') {
      const end = content.indexOf('\n', i);
      const stop = end < 0 ? content.length : end;
      tokens.push(['comment', content.slice(i, stop)]);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i,
        triple = content.slice(i, i + 3) === c.repeat(3),
        quote = triple ? c.repeat(3) : c;
      i += quote.length;
      while (i < content.length) {
        if (content[i] === '\\') {
          i += 2;
          continue;
        }
        if (content.slice(i, i + quote.length) === quote) {
          i += quote.length;
          break;
        }
        i++;
      }
      tokens.push(['literal', content.slice(start, i)]);
      continue;
    }
    const word = content.slice(i).match(/^[\p{L}\p{N}_]+/u)?.[0];
    if (word) {
      tokens.push(['word', word]);
      i += word.length;
      continue;
    }
    const operator = content
      .slice(i)
      .match(
        /^(?:\*\*=|\/\/=|<<=|>>=|:=|==|!=|<=|>=|\*\*|\/\/|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|->)/,
      )?.[0];
    if (operator) {
      tokens.push(['operator', operator]);
      i += operator.length;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    tokens.push(['char', c]);
    i++;
  }
  return JSON.stringify(tokens);
}
export function materialItemKey(item) {
  const content =
    item.kind === 'slide'
      ? item.content.normalize('NFKC').replace(/\s+/gu, '')
      : /^(python|py)$/i.test(item.language)
        ? pythonContentKey(item.content)
        : item.content;
  return JSON.stringify([item.kind, item.language, content]);
}

// A page may contain several blocks. Only suppress a whole screenshot when
// the same code is visible. Preserve slide/diagram screenshots even if their
// labels match, and always keep source images whose text could not be read.
export function materialFrameGroups(frames = []) {
  const byContent = new Map(),
    groups = [],
    byImage = new Map();
  for (const frame of [...frames].sort((a, b) => a.time - b.time)) {
    const complete =
      frame.items?.length &&
      frame.items.every((item) => item.kind === 'code' && !item.content.includes('[无法辨认]'));
    const samePython =
      complete && frame.items.every((item) => /^(python|py)$/i.test(item.language));
    const key = complete
      ? samePython
        ? pythonContentKey(frame.items.map((item) => item.content).join('\n'))
        : JSON.stringify(frame.items.map(materialItemKey))
      : null;
    let group = key && byContent.get(key);
    if (!group) {
      group = { representative: frame, frames: [] };
      groups.push(group);
      if (key) byContent.set(key, group);
    }
    group.frames.push(frame);
    if (frame.imageId) byImage.set(frame.imageId, group);
  }
  return { groups, byImage };
}
export function materialImages(data, images, all = false) {
  if (all) return images;
  const { groups, byImage } = materialFrameGroups(data?.frames || []),
    present = new Set(images.map((image) => image.id)),
    selected = new Set();
  for (const group of groups) {
    const first = [...group.frames]
      .sort(
        (a, b) => a.items.filter((i) => i.partial).length - b.items.filter((i) => i.partial).length,
      )
      .find((frame) => present.has(frame.imageId) && !(frame.blank && !frame.items.length));
    if (first) selected.add(first.imageId);
  }
  const linked = selected.size > 0,
    finishedFresh = data?.run?.status === 'done' && data.run.scope === 'beginning';
  return images.filter(
    (image) => selected.has(image.id) || (!byImage.has(image.id) && !(linked && finishedFresh)),
  );
}
