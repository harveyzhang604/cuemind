"""Independently inspect public ZIPs with Python's standard ZIP/CRC implementation."""
from pathlib import Path
import hashlib, json, subprocess, tempfile, zipfile

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / 'package.json').read_text())['version']
policy = json.loads((ROOT / 'scripts/public-files.json').read_text())
source = set(sum(policy.values(), []))
runtime = {p.removeprefix('extension/') for p in policy['extension']} | set(policy['documentation'])
for name, prefix, expected in [
    (f'CueMind-v{version}.zip', 'CueMind', runtime),
    (f'CueMind-source-v{version}.zip', 'CueMind-source', source),
]:
    path = ROOT / 'dist' / name
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert (Path(str(path) + '.sha256').read_text().split()[0]) == digest
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, 'Independent ZIP CRC failed'
        names = archive.namelist()
        assert len(names) == len(set(names)) == len(expected)
        assert set(names) == {f'{prefix}/{p}' for p in expected}
        for item in archive.infolist():
            assert item.date_time == (2000, 1, 1, 0, 0, 0)
            assert item.external_attr >> 16 == 0o100644
        manifest_path = 'extension/manifest.json' if prefix.endswith('-source') else 'manifest.json'
        assert json.loads(archive.read(f'{prefix}/{manifest_path}'))['version'] == version
        if prefix.endswith('-source'):
            with tempfile.TemporaryDirectory(prefix='cuemind-public-source-') as temporary:
                archive.extractall(temporary)
                checkout = Path(temporary) / prefix
                subprocess.run(['git', 'init', '-q'], cwd=checkout, check=True)
                # Fake private evidence is local, and git add -A cannot include it.
                for private in ['.env', 'docs/screenshots/private.png', '.private/backup.json', 'dist/old.zip']:
                    target = checkout / private
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text('synthetic private fixture')
                subprocess.run(['git', 'add', '-A'], cwd=checkout, check=True)
                visible = subprocess.check_output(['git', 'ls-files', '-z'], cwd=checkout).decode().split('\0')
                assert set(filter(None, visible)) == source
                subprocess.run(['node', 'scripts/check.mjs'], cwd=checkout, check=True)
                readme = checkout / 'README.md'
                original = readme.read_text()
                fake = 'sk-' + 'Z' * 32
                readme.write_text(original + '\n' + fake + '\n')
                subprocess.run(['git', 'add', 'README.md'], cwd=checkout, check=True)
                readme.write_text(original)
                hidden = subprocess.run(['node', 'scripts/check.mjs'], cwd=checkout, capture_output=True, text=True)
                assert hidden.returncode != 0 and 'index:README.md' in hidden.stderr
                assert fake not in hidden.stderr and fake not in hidden.stdout
                subprocess.run(['git', 'add', 'README.md'], cwd=checkout, check=True)
                subprocess.run(['git', 'add', '-f', '.env'], cwd=checkout, check=True)
                blocked = subprocess.run(['node', 'scripts/check.mjs'], cwd=checkout, capture_output=True, text=True)
                assert blocked.returncode != 0
                assert 'outside the public allowlist' in blocked.stderr
    print(f'Independent archive check passed: {name}, {len(expected)} public files, CRC, SHA-256 and manifest.')
