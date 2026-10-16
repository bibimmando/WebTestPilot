"""Offline integrity/reference check of the shared baseline, never a live site test."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports/maison_2026-10-16'


def main():
    data = json.loads((REPORT / 'baseline.json').read_text(encoding='utf-8'))
    ids = set()
    for item in data['representative_evidence']:
        folder = REPORT / item['folder']
        finding = json.loads((folder / 'finding.json').read_text(encoding='utf-8'))
        replay = json.loads((folder / 'reproduction.json').read_text(encoding='utf-8'))
        if finding['status'] != 'confirmed' or replay['result']['status'] != 'reproduced':
            raise ValueError('baseline requires actual confirmed/reproduced records')
        for ref in set(finding['snapshot_ids']) | set(replay['result']['snapshot_ids']):
            if not (folder / 'snapshots' / (ref + '.json')).is_file():
                raise ValueError('missing evidence snapshot: ' + ref)
        for image in replay['result'].get('images', {}).values():
            path = folder / image['path'].replace('\\', '/')
            if not path.resolve().is_relative_to(folder.resolve()) or not path.is_file():
                raise ValueError('missing image evidence')
        ids.add(item['bug_id'])
    if ids != set(data['confirmed_bug_ids']) or len(ids) != data['count']:
        raise ValueError('baseline bug IDs do not match')
    print('Offline shared evidence verified: ' + str(len(ids)) + '/' + str(data['total']) + '; no browser/API calls')


if __name__ == '__main__':
    main()
