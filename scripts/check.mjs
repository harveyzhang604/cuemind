import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { policy, extensionEntries } from './release-policy.mjs';
const list = await policy();
for (const file of list.source.filter((x) => /\.(?:js|mjs)$/.test(x)))
  execFileSync(process.execPath, ['--check', file]);
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.version !== pkg.version || pkg.license !== 'MIT')
  throw new Error('Version or license metadata mismatch');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid release version');
const refs = [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  manifest.options_page,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap((x) => x.js),
];
for (const file of refs)
  if (!list.extension.includes(`extension/${file}`))
    throw new Error(`Manifest file is not public: ${file}`);
for (const path of list.extension.filter((x) => x.endsWith('.html'))) {
  const html = await readFile(path, 'utf8');
  if (/<script(?![^>]*src=)[^>]*>[^<]+/i.test(html) || /\son\w+=/i.test(html))
    throw new Error(`Inline script violates CSP: ${path}`);
}
const runtime = new Set(extensionEntries(list).map((e) => e.path));
for (const file of list.documentation.filter((x) => x.endsWith('.md'))) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^https?:|^mailto:/.test(target)) continue;
    const { posix } = await import('node:path');
    const path = posix.normalize(posix.join(posix.dirname(file), target));
    if (!runtime.has(path))
      throw new Error(`Broken release documentation link: ${file} -> ${target}`);
  }
}
console.log(
  `Checked ${list.source.length} public source files: allowlist, credentials, syntax, manifest, versions, CSP and release document links. Git file check: ${list.git ? 'passed' : 'not available (no repository history here)'}.`,
);
