#!/usr/bin/env python3
"""Package the six allowlisted mod files as a deterministic local-import ZIP."""
import argparse
import hashlib
import json
from pathlib import Path
import stat
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir', type=Path, default=root / 'dist')
args = parser.parse_args()
paths = ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/attentionfarm.mjs', 'types/index.d.ts', 'README.md', 'INSTALL.md']
manifest = json.loads((root / paths[0]).read_text())
if manifest['name'] != 'attentionfarm' or manifest['version'] != '0.2.0':
    raise SystemExit('Unexpected candidate identity/version')
for relative in paths:
    if not (root / relative).is_file() or (root / relative).is_symlink():
        raise SystemExit(f'Missing or linked release input: {relative}')
args.output_dir.mkdir(parents=True, exist_ok=True)
archive = args.output_dir / 'attentionfarm-mod-v0.2.0.zip'
records = []
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for relative in sorted(paths):
        data = (root / relative).read_bytes()
        info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | 0o644) << 16
        bundle.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        records.append({'path': relative, 'mode': '0644', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert sorted(bundle.namelist()) == sorted(paths)
    for record in records:
        assert bundle.read(record['path']) == (root / record['path']).read_bytes()
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(archive.parent / (archive.name + '.sha256')).write_text(f'{digest}  {archive.name}\n')
(archive.parent / 'FILES.json').write_text(json.dumps({'archive': archive.name, 'sha256': digest, 'files': records}, indent=2) + '\n')
print(json.dumps({'archive': str(archive), 'sha256': digest, 'bytes': archive.stat().st_size, 'files': len(records)}, indent=2))
