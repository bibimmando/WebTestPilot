"""Synchronize the member-02 canonical judgment into its own standalone integration."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sync(apply=False):
    source = ROOT / 'src/ai_inspection/judgment'
    destination = ROOT / 'integration/judgment'
    files = {}
    for path in sorted(source.rglob('*')):
        relative = path.relative_to(source)
        if (not path.is_file() or any(p in ('test', '__pycache__') for p in relative.parts)
                or path.suffix not in ('.py', '.md', '.json')):
            continue
        target = destination / relative
        if not target.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError('destination must stay inside member-02')
        data = path.read_bytes()
        files[relative.as_posix()] = hashlib.sha256(data).hexdigest()
        if apply:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    manifest = {'source': 'src/ai_inspection/judgment', 'policy': 'member-02 standalone copy; no other team is modified', 'files': files}
    if apply:
        (destination / 'source_manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(('Applied' if args.apply else 'Preview') + ': ' + str(len(sync(args.apply)['files'])) + ' files inside member-02 only')
