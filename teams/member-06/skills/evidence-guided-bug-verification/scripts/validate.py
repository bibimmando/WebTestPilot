import argparse
import json
from pathlib import Path
from jsonschema import Draft202012Validator


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--schema', required=True)
    ap.add_argument('--data', required=True)
    args = ap.parse_args()
    schema = json.loads(Path(args.schema).read_text(encoding='utf-8'))
    Draft202012Validator.check_schema(schema)
    data = json.loads(Path(args.data).read_text(encoding='utf-8'))
    Draft202012Validator(schema).validate(data)
    if 'judgment' in data:
        evidence_ids = {x['id'] for x in data['evidence']}
        source_ids = {x['id'] for x in data['sources']}
        if len(evidence_ids) != len(data['evidence']) or len(source_ids) != len(data['sources']):
            raise ValueError('Duplicate evidence/source IDs')
        for observation in data['observations']:
            if not set(observation['evidence_ids']) <= evidence_ids:
                raise ValueError('Unknown observation evidence IDs')
        for key, ids in [('evidence_ids', evidence_ids), ('source_ids', source_ids)]:
            if not set(data['judgment'][key]) <= ids:
                raise ValueError(f'Unknown {key}')
        if data['judgment']['verdict'] != 'INCONCLUSIVE' and not data['judgment']['evidence_ids']:
            raise ValueError('Conclusive verdict requires cited observations')
    print('Valid')


if __name__ == '__main__':
    main()
