"""Render a generated PDF for visual QA (development dependency only)."""
import argparse
from pathlib import Path
import pymupdf

parser = argparse.ArgumentParser()
parser.add_argument("pdf", type=Path)
parser.add_argument("--output", type=Path, default=Path("tmp/pdfs"))
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
with pymupdf.open(args.pdf) as document:
    for number, page in enumerate(document, 1):
        page.get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(args.output / f"page-{number}.png")
    print(f"Rendered {len(document)} pages")
