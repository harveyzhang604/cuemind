# Development

Runtime: plain Manifest V3 HTML/CSS/JavaScript, no third-party runtime JS dependencies. Development: Node.js 22+, Python 3.12, Playwright 1.60.0. Prettier is a pinned development-only tool.

```bash
npm ci
npm test
npm run check
npm run format:check
npm run build
python3 tests/release_archive.py
```

For browser fixtures:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m playwright install chromium
CUEMIND_PYTHON=.venv/bin/python npm run test:browser
```

On Windows use `.venv\Scripts\python.exe` and set CUEMIND_PYTHON to that path. Linux without a display uses `xvfb-run -a npm run test:browser`; Playwright's `install --with-deps chromium` provides OS dependencies. CUEMIND_CHROMIUM can override the browser executable. Headless extension fixtures use the full `chromium` channel, following [Playwright's extension guidance](https://playwright.dev/python/docs/chrome-extensions), rather than the headless shell. Tests use isolated temporary browser profiles, synthetic responses and local servers; never configure real keys or use your daily Chrome profile for fixtures. The suite includes extension contexts and may require a headed Chromium/Xvfb for certain tests.

`npm run preview` serves a localhost demo; real video APIs require loading extension/ in Chrome. `npm run format` formats runtime sources, release scripts and release-policy tests. Runtime installation requires no build step.

## Architecture

- background.js validates extension messages, mediates settings, platform access and task lifecycle.
- content/player.js coordinates video playback, selection/replay shortcuts and caption overlay.
- core/ contains pure transcript, sentence, citation, focus, conversation and export logic.
- services/ contains provider adapters, prompts, task batching, overview/focus analysis and validated persistent response reuse.
- storage/db.js holds videos, notes, chats and aiCache; changes must preserve existing records and user edits.
- panel/app.js coordinates views; focus-ui.js owns the focus modal; text.js owns copy/answer/search text helpers. Keep new view-specific work in small modules, passing explicit state/dependencies instead of adding globals.
- offscreen/ handles explicitly requested audio capture/transcription.

## Public files and secrets

scripts/public-files.json defines exact extension, documentation and repository files. `.gitignore` defaults to ignoring unknown files and allows these public files. New files must be added to both lists; npm run check rejects unexpected visible or tracked Git files and all unexpected extension files. It scans staged blobs as well as working files, so removing a key only from the working copy cannot conceal it in the next commit. Do not force-add a private file.

Build produces an extension ZIP and a public source ZIP with exactly those lists, checks decompressed entries and credentials, and emits SHA-256 and file lists. It replaces generated dist/CueMind in place for local unpacked installs. Personal source screenshots stay outside the package and are not deleted. Historical dist archives remain local and must not be published as current releases.

Keys exist only in the installed extension's browser storage and provider authentication, never in config.js or .env. Backups exclude settings keys but contain user content, so keep them private. CI has no provider keys or publication credentials. GitHub private vulnerability reporting and branch protections are repository settings the maintainer must enable after creating the actual repository.

Before publication run `node scripts/check-history.mjs` in the actual Git repository. The local source workspace may lack .git, so npm run check only confirms current public files in that case. Historical image/binary secrets require manual review; automated text rules are not comprehensive.

## Release acceptance

1. Tests, static/public checks, format checks, history scan and build pass.
2. Use an empty test browser profile to install the generated package, read original captions without keys, configure providers yourself and confirm bilingual translation, replay, notes, explanation reuse and export.
3. Upgrade the same loaded directory and verify settings, existing notes, translations and per-goal focus survive. Never uninstall user data to test upgrades.
4. Check representative real YouTube and Bilibili pages. Fixture results cannot prove platform selectors or paid-service behavior.
5. Publish only reviewed current archives with checksums; no personal profile screenshots, old archives or local reports. Update CHANGELOG and privacy docs when behavior changes.

Edge is not independently certified. Add a dedicated acceptance run before changing its support status.
