import argparse
import asyncio
import json
import math
import sys

from .crawl import crawl


def _pos_int(v):
    # 양의 정수 검증
    n = int(v)
    if n < 1:
        raise argparse.ArgumentTypeError('must be >= 1')
    return n


def _pos_float(v):
    # 양의 실수 검증
    f = float(v)
    if f <= 0 or not math.isfinite(f):
        raise argparse.ArgumentTypeError('must be > 0')
    return f


def _nonneg_float(v):
    # 0 이상 실수 검증
    f = float(v)
    if f < 0 or not math.isfinite(f):
        raise argparse.ArgumentTypeError('must be >= 0')
    return f


def _summary_bytes(v):
    n = _pos_int(v)
    if n < 2048:
        raise argparse.ArgumentTypeError('must be >= 2048')
    return n


def build_parser():
    # single/crawl 하위 명령 파서 구성
    p = argparse.ArgumentParser(prog='wtp_preprocessor')
    sub = p.add_subparsers(dest='cmd', required=True)
    for name in ('single', 'crawl'):
        s = sub.add_parser(name)
        s.add_argument('url')
        s.add_argument('--output', required=True)
        s.add_argument('--ready-selector', default=None)
        s.add_argument('--headed', action='store_true')
        s.add_argument('--collection-timeout', type=_pos_float, default=15)
        s.add_argument('--summary-max-bytes', type=_summary_bytes, default=12288)
        s.add_argument('--hash-policy', choices=('conservative','preserve_all','strip_routes'), default='conservative')
        if name == 'crawl':
            s.add_argument('--max-pages', type=_pos_int, default=50)
            s.add_argument('--max-runtime', type=_pos_float, default=300)
            s.add_argument('--page-delay', type=_nonneg_float, default=1)
    return p


def main(argv=None):
    # 인자 해석 후 크롤 실행, 마스킹된 요약만 출력
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    a = build_parser().parse_args(argv)
    kw = dict(ready_selector=a.ready_selector, headed=a.headed, collection_timeout=a.collection_timeout,
              summary_max_bytes=a.summary_max_bytes, hash_policy=a.hash_policy)
    if a.cmd == 'single':
        kw.update(max_pages=1, page_delay=0)
    else:
        kw.update(max_pages=a.max_pages, max_runtime=a.max_runtime, page_delay=a.page_delay)
    try:
        summary = asyncio.run(crawl(a.url, a.output, **kw))
    except ValueError as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({'summary_path': summary['paths']['summary'], 'graph_path': summary['paths']['graph'],
                      'pages_visited': summary['pages_visited'], 'termination_reason': summary['termination_reason'],
                      'counts': summary['counts'], 'pending_count': summary['pending_count']},
                     ensure_ascii=False, indent=2))
    return 0
