"""Validate schema and final report references/counts without assigning verdicts."""
import argparse
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

def validate(schema, data, artifact_root=None):
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema,format_checker=FormatChecker()).validate(data)
    if data.get('schema_version') != 'wtp.verification/1':
        return
    def ids(items, key):
        values = [i[key] for i in items]
        if len(values) != len(set(values)):
            raise ValueError('Duplicate identifiers: ' + key)
        return set(values)
    candidates = ids(data['bug_candidates'],'id')
    artifacts = ids(data['artifacts'],'id')
    verified = ids(data['verifications'],'candidate_id')
    if candidates != verified:
        raise ValueError('Each candidate needs exactly one verification (use INCONCLUSIVE for pending)')
    for v in data['verifications']:
        if not set(v['evidence_refs']) <= artifacts:
            raise ValueError('Unknown evidence reference')
        if v['verdict'] == 'CONFIRMED' and not v['evidence_refs']:
            raise ValueError('Confirmed finding requires observation evidence')
    for a in data['artifacts']:
        if not set(a['candidate_ids']) <= candidates:
            raise ValueError('Unknown artifact candidate')
        if artifact_root:
            root = Path(artifact_root).resolve()
            path = (root / a['path']).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise ValueError('Missing artifact or path outside output folder')
    for key, verdict in [('confirmed','CONFIRMED'),('not_a_bug','NOT_A_BUG'),('inconclusive','INCONCLUSIVE')]:
        if data['summary'][key] != sum(v['verdict']==verdict for v in data['verifications']):
            raise ValueError('Summary count mismatch: ' + key)

if __name__ == '__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--schema',required=True)
    ap.add_argument('--data',required=True)
    ap.add_argument('--artifact-root')
    args=ap.parse_args()
    validate(json.loads(Path(args.schema).read_text(encoding='utf-8')),
             json.loads(Path(args.data).read_text(encoding='utf-8')),args.artifact_root)
    print('Valid')
