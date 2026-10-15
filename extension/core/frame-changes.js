// Screen content is compared locally. Compact moving overlays must not become
// new OCR jobs, while a persistent edit to one code character must still count.
export function updateFrameRegions(target, source, regions, width = 640) {
  if (!target) return;
  const height = Math.ceil(target.length / width);
  for (const r of regions) {
    if (r.transient === 'caret') continue;
    const left = Math.max(0, r.x - 2),
      right = Math.min(width, r.x + r.width + 2);
    for (let y = Math.max(0, r.y - 2); y < Math.min(height, r.y + r.height + 2); y++)
      target.set(source.subarray(y * width + left, y * width + right), y * width + left);
  }
}

export function backgroundDistance(signature, r, width = 640) {
  let distance = 0,
    count = 0;
  for (let y = r.y; y < r.y + r.height; y++) {
    const background =
      (signature[y * width + Math.max(0, r.x - 3)] +
        signature[y * width + Math.min(width - 1, r.x + r.width + 3)]) /
      2;
    for (let x = r.x; x < r.x + r.width; x++) {
      distance += Math.abs(signature[y * width + x] - background);
      count++;
    }
  }
  return distance / count;
}

function pointerShape(region, mask, width) {
  if (
    region.width < 4 ||
    region.width > 22 ||
    region.height < 7 ||
    region.height > 32 ||
    region.width > region.height * 1.3
  )
    return false;
  const rows = [];
  for (let y = region.y; y < region.y + region.height; y++) {
    let left = Infinity,
      right = -1;
    for (let x = region.x; x < region.x + region.width; x++)
      if (mask[y * width + x]) {
        left = Math.min(left, x);
        right = x;
      }
    if (right >= 0) rows.push({ left, width: right - left + 1 });
  }
  if (rows.length < 7) return false;
  const tip = rows.slice(0, Math.max(1, Math.floor(rows.length * 0.2)));
  const upper = rows.slice(0, Math.ceil(rows.length * 0.65));
  const tail = rows.slice(Math.floor(rows.length * 0.8));
  return (
    Math.max(...tip.map((r) => r.width)) <= region.width * 0.5 &&
    upper.filter((r) => r.left <= region.x + 1).length >= upper.length * 0.7 &&
    Math.max(...upper.map((r) => r.width)) >= region.width * 0.7 &&
    tail.reduce((sum, r) => sum + r.width, 0) / tail.length < region.width * 0.85
  );
}

function footprint(region, mask, width) {
  const cells = new Uint8Array(8 * 12);
  for (let y = region.y; y < region.y + region.height; y++)
    for (let x = region.x; x < region.x + region.width; x++)
      if (mask[y * width + x])
        cells[
          Math.min(11, Math.floor(((y - region.y) * 12) / region.height)) * 8 +
            Math.min(7, Math.floor(((x - region.x) * 8) / region.width))
        ] = 1;
  return cells;
}

export function frameChanges(a, b, width = 640, ignored = []) {
  if (!a || !b || a.length !== b.length || !a.length)
    return { pixels: b?.length || 1, broad: true, ignored: [] };
  const height = Math.ceil(a.length / width),
    cell = 4,
    columns = Math.ceil(width / cell);
  const mask = new Uint8Array(a.length),
    counts = new Uint16Array(columns * Math.ceil(height / cell));
  const excluded = new Uint8Array(a.length);
  for (const r of ignored)
    for (let y = Math.max(0, r.y - 2); y < Math.min(height, r.y + r.height + 2); y++)
      excluded.fill(
        1,
        y * width + Math.max(0, r.x - 2),
        y * width + Math.min(width, r.x + r.width + 2),
      );
  for (let i = 0; i < a.length; i++) {
    if (excluded[i] || Math.abs(a[i] - b[i]) < 24) continue;
    mask[i] = 1;
    counts[Math.floor(i / width / cell) * columns + Math.floor((i % width) / cell)]++;
  }
  const regions = [],
    seen = new Uint8Array(counts.length);
  for (let i = 0; i < counts.length; i++) {
    if (!counts[i] || seen[i]) continue;
    const queue = [i];
    seen[i] = 1;
    let count = 0,
      minX = width,
      minY = height,
      maxX = 0,
      maxY = 0;
    for (let q = 0; q < queue.length; q++) {
      const at = queue[q],
        x = at % columns,
        y = Math.floor(at / columns);
      count += counts[at];
      minX = Math.min(minX, x * cell);
      maxX = Math.max(maxX, (x + 1) * cell - 1);
      minY = Math.min(minY, y * cell);
      maxY = Math.max(maxY, (y + 1) * cell - 1);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nextX = x + dx,
            nextY = y + dy,
            next = nextY * columns + nextX;
          if (
            nextX < 0 ||
            nextX >= columns ||
            nextY < 0 ||
            next >= counts.length ||
            seen[next] ||
            !counts[next]
          )
            continue;
          seen[next] = 1;
          queue.push(next);
        }
    }
    if (count < 4) continue;
    const region = {
      x: minX,
      y: minY,
      width: Math.min(width - 1, maxX) - minX + 1,
      height: Math.min(height - 1, maxY) - minY + 1,
      count,
    };
    // Tight bounds and polarity are only needed for small overlay candidates.
    if (region.width <= 32 && region.height <= 40) {
      let left = width,
        top = height,
        right = 0,
        bottom = 0,
        positive = 0;
      for (let y = minY; y <= Math.min(height - 1, maxY); y++)
        for (let x = minX; x <= Math.min(width - 1, maxX); x++) {
          const at = y * width + x;
          if (!mask[at]) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          if (b[at] > a[at]) positive++;
        }
      Object.assign(region, {
        x: left,
        y: top,
        width: right - left + 1,
        height: bottom - top + 1,
        positive,
      });
      // A moved/added overlay mainly adds or removes ink. A code edit such as
      // 1 → 2 adds AND removes strokes in the same place; never mask that edit.
      region.pointer =
        (positive / count > 0.9 || positive / count < 0.1) && pointerShape(region, mask, width);
    }
    regions.push(region);
  }
  const noise = new Set(regions.filter((r) => r.pointer));
  const compact = regions.filter((r) => r.width <= 22 && r.height <= 32 && r.count <= 350);
  for (let i = 0; i < compact.length; i++)
    for (let j = i + 1; j < compact.length; j++) {
      const old = compact[i],
        next = compact[j];
      if (
        Math.abs(old.x - next.x) <= Math.max(old.width, next.width) + 2 &&
        Math.abs(old.y - next.y) <= Math.max(old.height, next.height) + 2
      )
        continue;
      if (
        Math.abs(old.width - next.width) > 3 ||
        Math.abs(old.height - next.height) > 3 ||
        Math.min(old.count, next.count) / Math.max(old.count, next.count) < 0.6
      )
        continue;
      if (
        !(
          (old.positive / old.count > 0.75 && next.positive / next.count < 0.25) ||
          (next.positive / next.count > 0.75 && old.positive / old.count < 0.25)
        )
      )
        continue;
      const round = (r) =>
        r.width >= 3 &&
        r.height >= 3 &&
        r.width <= 14 &&
        r.height <= 14 &&
        r.width / r.height > 0.65 &&
        r.width / r.height < 1.5 &&
        r.count / (r.width * r.height) > 0.45;
      if (!old.pointer && !next.pointer && !(round(old) && round(next))) continue;
      const one = footprint(old, mask, width),
        two = footprint(next, mask, width);
      let intersection = 0,
        union = 0;
      for (let p = 0; p < one.length; p++) {
        if (one[p] && two[p]) intersection++;
        if (one[p] || two[p]) union++;
      }
      if (intersection / union >= 0.6) {
        noise.add(old);
        noise.add(next);
      }
    }
  const content = regions.filter((r) => !noise.has(r));
  const pixels = content.reduce((sum, r) => sum + r.count, 0);
  return {
    pixels,
    broad: pixels > a.length * 0.0015 || content.some((r) => r.width > 32 || r.height > 36),
    ignored: [...ignored, ...noise],
    regions: content,
  };
}

// Laser pointers have a compact saturated red core surrounded by a diffuse
// pink halo. Flat red text lacks that halo and remains part of the content.
export function laserPointerRegions(rgba, width = 640, height = 360) {
  const mask = new Uint8Array(width * height),
    regions = [];
  for (let i = 0; i < mask.length; i++) {
    const at = i * 4,
      r = rgba[at],
      g = rgba[at + 1],
      b = rgba[at + 2];
    if (r >= 210 && r - g >= 90 && r - b >= 90) mask[i] = 1;
  }
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    const queue = [i];
    mask[i] = 2;
    let minX = width,
      minY = height,
      maxX = 0,
      maxY = 0;
    for (let q = 0; q < queue.length; q++) {
      const at = queue[q],
        x = at % width,
        y = Math.floor(at / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy,
            next = yy * width + xx;
          if (xx < 0 || xx >= width || yy < 0 || yy >= height || mask[next] !== 1) continue;
          mask[next] = 2;
          queue.push(next);
        }
    }
    const w = maxX - minX + 1,
      h = maxY - minY + 1;
    if (
      queue.length < 2 ||
      queue.length > 150 ||
      w < 2 ||
      h < 2 ||
      w > 16 ||
      h > 16 ||
      w / h < 0.5 ||
      w / h > 2
    )
      continue;
    const cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2,
      radius = Math.max(w, h) / 2;
    let halo = 0;
    const quadrants = new Set();
    for (let y = Math.max(0, minY - 4); y <= Math.min(height - 1, maxY + 4); y++)
      for (let x = Math.max(0, minX - 4); x <= Math.min(width - 1, maxX + 4); x++) {
        if (Math.hypot(x - cx, y - cy) < radius + 1) continue;
        const at = (y * width + x) * 4,
          r = rgba[at],
          g = rgba[at + 1],
          b = rgba[at + 2];
        if (r >= 200 && g > 100 && b > 100 && r - g >= 10 && r - b >= 10 && Math.abs(g - b) < 45) {
          halo++;
          quadrants.add((x >= cx ? 1 : 0) + (y >= cy ? 2 : 0));
        }
      }
    if (halo >= 4 && quadrants.size >= 3)
      regions.push({
        x: Math.max(0, minX - 4),
        y: Math.max(0, minY - 4),
        width: w + 8,
        height: h + 8,
      });
  }
  return regions;
}
