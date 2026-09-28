import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  assertPublicPath,
  assertNoSecrets,
  validatePublicFile,
} from '../scripts/release-policy.mjs';
import { zip, inspectZip } from '../scripts/archive.mjs';

test('publication rejects traversal, secrets, backup files and redacts the credential', () => {
  for (const path of [
    '../key.txt',
    '/tmp/data',
    'a/../data',
    '.env',
    'data/.env.local',
    'config.js',
    'backup.docx',
    'old.zip',
    'a\\b',
  ])
    assert.throws(() => assertPublicPath(path));
  for (const key of [
    'sk-' + 'A'.repeat(32),
    'sd_' + 'B'.repeat(32),
    'gsk_' + 'C'.repeat(36),
    'ghp_' + 'D'.repeat(32),
  ]) {
    let error;
    try {
      assertNoSecrets('secret ' + key, 'fixture.js');
    } catch (e) {
      error = e;
    }
    assert.ok(error);
    assert.ok(!error.message.includes(key));
  }
  assert.throws(() => assertNoSecrets('{"format":"cuemind","videos":[]}', 'backup.json'));
  assertNoSecrets('const apiKey = "";', 'settings.js');
});
test('publication rejects both file and directory symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cuemind-publish-'));
  try {
    await mkdir(join(dir, 'real'));
    await writeFile(join(dir, 'real', 'file.txt'), 'public');
    await symlink(join(dir, 'real'), join(dir, 'link'), 'dir');
    await symlink(join(dir, 'real', 'file.txt'), join(dir, 'file.txt'));
    await assert.rejects(() => validatePublicFile(dir, 'link/file.txt'), /Symlink/);
    await assert.rejects(() => validatePublicFile(dir, 'file.txt'), /Symlink/);
    assert.equal((await validatePublicFile(dir, 'real/file.txt')).toString(), 'public');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('portable ZIP preserves Unicode names and bytes and builds deterministically', () => {
  const entries = [
    { path: 'CueMind/字幕.txt', data: Buffer.from('Hello 字幕') },
    { path: 'CueMind/icons/icon.png', data: Buffer.from([0, 255, 1, 2]) },
  ];
  const one = zip(entries);
  assert.deepEqual(one, zip(entries));
  assert.deepEqual(inspectZip(one), entries);
  const damaged = Buffer.from(one);
  damaged[14] ^= 1;
  assert.throws(() => inspectZip(damaged), /Corrupt/);
  assert.throws(() => zip([{ path: '../key', data: Buffer.from('bad') }]), /Unsafe/);
});

test('history scan catches a credential removed from the latest commit without displaying it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cuemind-history-'));
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    const secret = 'sk-' + 'F'.repeat(32);
    await writeFile(join(dir, 'removed.json'), JSON.stringify({ apiKey: secret }));
    git(['add', 'removed.json']);
    git(['commit', '-qm', 'Synthetic credential fixture']);
    git(['rm', 'removed.json']);
    git(['commit', '-qm', 'Remove fixture']);
    const result = spawnSync(process.execPath, [resolve('scripts/check-history.mjs')], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Possible credential in history/);
    assert.ok(!result.stderr.includes(secret));
    assert.ok(!result.stdout.includes(secret));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
