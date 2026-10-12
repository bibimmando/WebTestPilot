import argparse
import json
from pathlib import Path
import sys

from .contract import SCHEMA, InputError
from .render import generate


def main(argv=None):
    parser = argparse.ArgumentParser(description="Offline JSON + evidence to one Korean PDF")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--evidence-root", type=Path, help="defaults to input JSON parent")
    parser.add_argument("--font", type=Path, help="Korean TrueType font")
    parser.add_argument("--write-schema", type=Path, help="export schema and exit")
    args = parser.parse_args(argv)
    if args.write_schema:
        args.write_schema.write_text(json.dumps(SCHEMA, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return 0
    if not args.input or not args.output:
        parser.error("--input and --output are required")
    if args.output.resolve() == args.input.resolve():
        parser.error("input must not be overwritten")
    try:
        if args.input.stat().st_size > 10 * 1024 * 1024:
            raise InputError("Input exceeds 10 MB")
        data = json.loads(args.input.read_text(encoding="utf-8-sig"))
        result = generate(data, args.evidence_root or args.input.parent, args.output, args.font)
    except InputError as error:
        print(f"Report failed: {error}. Source files preserved.", file=sys.stderr)
        return 1
    except (OSError, ValueError):
        print("Report failed: check input schema, references, Korean font and output access. Source files preserved.", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
