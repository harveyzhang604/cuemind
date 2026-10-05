import { spawnSync } from 'node:child_process';
const python = process.env.CUEMIND_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const tests = [
  'cache_workflow',
  'settings_persistence',
  'settings_refresh_extension',
  'panel_race',
  'panel_follow',
  'compact_workflow',
  'explanation_modal',
  'zara_browser',
  'bilibili_follow',
  'migu_clock',
  'replay_keyboard',
  'player_platform',
];
for (const name of tests) {
  console.log(`Browser regression: ${name}`);
  const result = spawnSync(python, [`tests/${name}.py`], { stdio: 'inherit' });
  if (result.error)
    throw new Error('Python is unavailable; set CUEMIND_PYTHON to your virtualenv executable.');
  if (result.status !== 0) process.exit(result.status || 1);
}
