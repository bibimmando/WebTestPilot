"""Agent-selected exploration plan. No fixed crawling or automatic bug decisions."""
import argparse
import asyncio
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
from reproduce import ROOT, run
from browser_actions import origin

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--input',required=True)
    ap.add_argument('--plan',required=True)
    ap.add_argument('--out',required=True)
    args = ap.parse_args()
    context = json.loads(Path(args.input).read_text(encoding='utf-8'))
    schema = json.loads((ROOT/'schemas/site_context.schema.json').read_text(encoding='utf-8'))
    Draft202012Validator(schema,format_checker=FormatChecker()).validate(context)
    plan = json.loads(Path(args.plan).read_text(encoding='utf-8'))
    if not {origin(u) for u in plan['authorization']['origins']} <= {origin(u) for u in context['authorization']['origins']}:
        raise ValueError('Plan expands user scope')
    record = asyncio.run(run(plan,args.out))
    record['site_context_ref'] = args.input
    (Path(args.out)/'execution.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
    print(record['execution_status'])
    raise SystemExit(0 if record['execution_status']=='COMPLETED' else 1)
