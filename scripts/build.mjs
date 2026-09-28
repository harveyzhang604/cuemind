import { mkdir, rm, writeFile, readFile, readdir, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { policy, extensionEntries, assertNoSecrets, assertPublicPath } from './release-policy.mjs';
import { zip, inspectZip } from './archive.mjs';
execFileSync(process.execPath, ['scripts/check.mjs'], { stdio: 'inherit' });
const list = await policy(),
  { version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('dist', { recursive: true });
const runtime = await Promise.all(
  extensionEntries(list).map(async (e) => ({ ...e, data: await readFile(e.source) })),
);
const source = await Promise.all(
  list.source.map(async (path) => ({ path, data: await readFile(path) })),
);
for (const [name, prefix, entries] of [
  [`CueMind-v${version}.zip`, 'CueMind', runtime],
  [`CueMind-source-v${version}.zip`, 'CueMind-source', source],
]) {
  const expected = entries.map((e) => `${prefix}/${e.path}`),
    bytes = zip(entries.map((e) => ({ path: `${prefix}/${e.path}`, data: e.data })));
  const actual = inspectZip(bytes);
  if (JSON.stringify(actual.map((e) => e.path)) !== JSON.stringify(expected))
    throw new Error('Final ZIP file list mismatch');
  for (const e of actual) {
    assertPublicPath(e.path);
    if (
      /\.(?:js|mjs|json|html|css|md|txt|yml|yaml|py|svg)$/.test(e.path) ||
      e.path.endsWith('/LICENSE')
    )
      assertNoSecrets(e.data.toString('utf8'), e.path);
  }
  const file = `dist/${name}`;
  await writeFile(file + '.tmp', bytes);
  await rename(file + '.tmp', file);
  await writeFile(
    file + '.sha256',
    `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`,
  );
  await writeFile(file + '.files.txt', expected.join('\n') + '\n');
  console.log(
    `Built ${file}: ${entries.length} verified public files; SHA-256 and file list saved.`,
  );
}
// Keep the loaded directory present during replacement. Personal source screenshots
// remain untouched; only obsolete files in the generated installation are removed.
async function files(root, prefix = '') {
  const all = [];
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, item.name);
    if (item.isDirectory()) all.push(...(await files(root, path)));
    else all.push(path);
  }
  return all;
}
const target = 'dist/CueMind';
await mkdir(target, { recursive: true });
for (const e of runtime) {
  const file = join(target, e.path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file + '.tmp', e.data);
  await rename(file + '.tmp', file);
}
const wanted = new Set(runtime.map((e) => e.path));
for (const path of await files(target))
  if (!wanted.has(path)) await rm(join(target, path), { force: true });
