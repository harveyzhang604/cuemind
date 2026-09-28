import { readFile, lstat, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, relative, posix } from 'node:path';

export const secretPatterns = [
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bsd_[A-Za-z0-9_-]{16,}\b/,
  /\bgsk_[A-Za-z0-9]{30,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["'][^"'\s]{24,}["']/i,
];
export function assertPublicPath(path) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\\') ||
    path.startsWith('/') ||
    posix.normalize(path) !== path ||
    path.split('/').some((p) => p === '..' || !p)
  )
    throw new Error('Unsafe public file path');
  if (
    /(^|\/)(?:\.env(?:\..*)?|config\.js|\.DS_Store|\.git|__pycache__)(\/|$)|\.(?:pem|key|p12|pfx|docx|zip|pyc)$/i.test(
      path,
    )
  )
    throw new Error(`Private file cannot be public: ${path}`);
}
export function assertNoSecrets(text, path) {
  if (secretPatterns.some((pattern) => pattern.test(text)))
    throw new Error(
      `Possible credential in ${path}; remove it before publication (value redacted)`,
    );
  if (
    /"format"\s*:\s*"cuemind"/.test(text) &&
    /"videos"\s*:\s*\[/.test(text) &&
    path.endsWith('.json')
  )
    throw new Error(`Learning backup cannot be public: ${path}`);
}
export async function validatePublicFile(root, path) {
  assertPublicPath(path);
  // Reject symlinks in every component, including a parent directory.
  let current = resolve(root);
  for (const part of path.split('/')) {
    current = resolve(current, part);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error(`Symlink cannot be public: ${path}`);
  }
  if (!(await lstat(current)).isFile()) throw new Error(`Not a regular public file: ${path}`);
  const data = await readFile(current);
  if (
    /\.(?:js|mjs|json|html|css|md|txt|yml|yaml|sh|py|svg)$/.test(path) ||
    /(?:^|\/)(?:LICENSE|\.gitignore|\.prettierignore)$/.test(path)
  )
    assertNoSecrets(data.toString('utf8'), path);
  return data;
}
export async function policy(root = process.cwd()) {
  const list = JSON.parse(await readFile(resolve(root, 'scripts/public-files.json'), 'utf8'));
  for (const key of ['extension', 'documentation', 'repository']) {
    if (!Array.isArray(list[key]) || new Set(list[key]).size !== list[key].length)
      throw new Error(`Invalid public ${key} list`);
    list[key].forEach(assertPublicPath);
  }
  const source = [
    ...new Set([...list.extension, ...list.documentation, ...list.repository]),
  ].sort();
  for (const path of source) await validatePublicFile(root, path);
  const actual = [];
  async function walk(dir) {
    for (const entry of await readdir(resolve(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else actual.push(path);
    }
  }
  await walk('extension');
  for (const path of actual)
    if (!list.extension.includes(path))
      throw new Error(`Extension file is outside the public allowlist: ${path}`);
  // .gitignore is not enough for already tracked files. Reject unexpected tracked
  // files and visible new files, without printing their contents or credentials.
  let git = false;
  try {
    git =
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim() === resolve(root);
  } catch {}
  if (git) {
    const files = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: root },
    )
      .toString()
      .split('\0')
      .filter(Boolean);
    for (const path of files) {
      if (!source.includes(path))
        throw new Error(`Repository file is outside the public allowlist: ${path}`);
      await validatePublicFile(root, path);
    }
    // A clean working copy can still conceal an older staged secret. Inspect the
    // index blobs too, since Git commits the index rather than working files.
    const staged = execFileSync('git', ['ls-files', '-s', '-z'], { cwd: root })
      .toString()
      .split('\0')
      .filter(Boolean);
    for (const row of staged) {
      const tab = row.indexOf('\t'),
        path = row.slice(tab + 1);
      const [mode, id, stage] = row.slice(0, tab).split(' ');
      if (stage !== '0' || mode === '120000') throw new Error(`Unsafe staged file: ${path}`);
      const bytes = execFileSync('git', ['cat-file', 'blob', id], { cwd: root });
      if (
        /\.(?:js|mjs|json|html|css|md|txt|yml|yaml|sh|py|svg)$/.test(path) ||
        /(?:^|\/)(?:LICENSE|\.gitignore|\.prettierignore)$/.test(path)
      )
        assertNoSecrets(bytes.toString('utf8'), `index:${path}`);
    }
  }
  return { ...list, source, git };
}
export function extensionEntries(list) {
  return [
    ...list.extension.map((path) => ({ source: path, path: path.replace(/^extension\//, '') })),
    ...list.documentation.map((path) => ({ source: path, path })),
  ].sort((a, b) => a.path.localeCompare(b.path));
}
