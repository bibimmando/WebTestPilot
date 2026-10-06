import sys

from .cli import main


def _run():
    # 모듈 실행 진입점
    sys.exit(main())


if __name__ == '__main__':
    _run()
