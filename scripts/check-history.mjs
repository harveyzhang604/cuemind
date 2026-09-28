import { execFileSync } from 'node:child_process';
import { assertNoSecrets } from './release-policy.mjs';
let commits;
try {
  commits = execFileSync('git', ['rev-list', '--all'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 20 * 1024 * 1024,
  })
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean);
} catch {
  throw new Error('Git history is unavailable. Run this in the actual publication repository.');
}
const seen = new Set();
let checked = 0;
for (const commit of commits) {
  const files = execFileSync('git', ['ls-tree', '-r', '-z', commit], {
    maxBuffer: 20 * 1024 * 1024,
  })
    .toString()
    .split('\0')
    .filter(Boolean);
  for (const entry of files) {
    const tab = entry.indexOf('\t'),
      path = entry.slice(tab + 1),
      [, type, id] = entry.slice(0, tab).split(' ');
    if (
      type !== 'blob' ||
      seen.has(id) ||
      !(
        /\.(?:js|mjs|json|html|css|md|txt|yml|yaml|sh|py|svg|env)$/.test(path) ||
        /(^|\/)\.env(?:\.|$)/.test(path)
      )
    )
      continue;
    seen.add(id);
    const text = execFileSync('git', ['cat-file', 'blob', id], {
      maxBuffer: 50 * 1024 * 1024,
    }).toString();
    assertNoSecrets(text, `history ${commit.slice(0, 12)}:${path}`);
    checked++;
  }
}
console.log(
  `Scanned ${checked} unique text blobs across ${commits.length} commits; no credential patterns found. Images and unrecognised secret formats require review.`,
);
