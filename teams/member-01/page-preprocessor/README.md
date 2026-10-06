# 페이지 전처리·URL 크롤러

설치·실행 명령, 옵션, 페이지별 출력 폴더와 snapshot/AI 입력 연결은 [member-01 사용 안내](../README.md)에 정리되어 있다.

- 실행: `python -m wtp_preprocessor single <URL> --output runs/single`
- 순회: `python -m wtp_preprocessor crawl <URL> --output runs/crawl --max-pages 100 --max-runtime 600 --page-delay 2`
- 테스트: `python -m pytest -q`
- AI 팀 연결: [AI 입력·조작 증거 규격](docs/AI_INPUT_CONTRACT.md)

실행에는 설치된 Python·Playwright Chromium이 필요하다. CLI 자체는 유료 모델 API를 호출하지 않는다.
