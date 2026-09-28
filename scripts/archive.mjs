import { deflateRawSync, inflateRawSync } from 'node:zlib';

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Small deterministic ZIP32 writer: no shell zip dependency on Windows/macOS/Linux.
// UTF-8 names, fixed 2000-01-01 timestamps, deflate and Unix regular-file mode.
export function zip(entries) {
  const chunks = [],
    directory = [];
  let offset = 0;
  if (entries.length > 65535 || new Set(entries.map((e) => e.path)).size !== entries.length)
    throw new Error('Invalid ZIP entries');
  for (const { path, data } of entries) {
    if (
      !path ||
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').some((p) => !p || p === '..')
    )
      throw new Error('Unsafe ZIP path');
    const name = Buffer.from(path),
      compressed = deflateRawSync(data, { level: 9 }),
      checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x2821, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x2821, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 * 65536) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = directory.reduce((n, b) => n + b.length, 0),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...directory, end]);
}
export function inspectZip(bytes) {
  const entries = [];
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8),
      checksum = bytes.readUInt32LE(offset + 14),
      size = bytes.readUInt32LE(offset + 18),
      length = bytes.readUInt32LE(offset + 22),
      nameSize = bytes.readUInt16LE(offset + 26),
      extraSize = bytes.readUInt16LE(offset + 28);
    const path = bytes.subarray(offset + 30, offset + 30 + nameSize).toString('utf8'),
      start = offset + 30 + nameSize + extraSize;
    const data =
      method === 8
        ? inflateRawSync(bytes.subarray(start, start + size))
        : bytes.subarray(start, start + size);
    if (data.length !== length || crc32(data) !== checksum)
      throw new Error(`Corrupt ZIP entry: ${path}`);
    entries.push({ path, data });
    offset = start + size;
  }
  if (bytes.readUInt32LE(offset) !== 0x02014b50 && bytes.readUInt32LE(offset) !== 0x06054b50)
    throw new Error('Invalid ZIP directory');
  return entries;
}
