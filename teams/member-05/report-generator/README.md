# 독립 PDF 보고서 프로토타입

`wtp.report_input/0.1` JSON 1개와 연결 증거 폴더를 읽어 실행 전체의 한글 PDF 1개를 만듭니다.
현재 검사기·최종 버그 판정·자동 재현과 **연동되지 않은 독립 모듈**입니다. API 키, 브라우저, 네트워크 호출이 필요하지 않습니다.
보고서 AI 문장화는 아직 구현하지 않았으며, 이 프로토타입은 저장된 사실을 정해진 레이아웃에 배치합니다.

## 실행

이 디렉토리에서 Python 3.11 이상으로 실행합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m wtp_report --input examples/demo/report_input.json --output output/pdf/demo-report.pdf
```

샘플의 모든 기록과 이미지는 **합성 예시**입니다. 실제 사이트 검사나 결함 탐지 결과가 아닙니다.
샘플 이미지 재생성이 필요하면 Windows에서 `python scripts/make_demo_image.py`를 실행합니다.

Windows는 맑은 고딕, Linux는 `/usr/share/fonts/truetype/nanum/NanumGothic.ttf`를 찾습니다.
다른 환경은 `--font /path/to/korean.ttf` 또는 `WTP_REPORT_FONT`로 한글 TrueType 폰트를 지정하세요.
폰트는 PDF에 포함되며, 사용할 폰트의 배포 조건은 각 환경에서 확인합니다.

## 입력과 출력

- 입력 예시: [examples/demo/report_input.json](examples/demo/report_input.json)
- 기계 검증 규격: [report-input.schema.json](report-input.schema.json)
- 전체 흐름·생산자 책임·후속 연결: [FLOW_AND_CONTRACT.md](FLOW_AND_CONTRACT.md)
- 출력: 지정한 PDF 1개. 표준 출력에는 코드 집계와 증거 경고 JSON을 표시합니다.

증거 경로는 기본적으로 입력 JSON의 폴더 기준입니다. 다른 묶음은 `--evidence-root ./bundle`로 지정합니다.
절대 경로·외부 URL·상위 폴더 이탈·외부를 가리키는 심볼릭 링크는 읽지 않습니다.
출력은 원본 증거 묶음 밖으로 지정해야 합니다. 기존 PDF는 생성 성공 후에만 원자적으로 교체합니다.
입력 JSON과 증거를 수정하지 않으며, 재실행해도 사이트를 재검사하지 않습니다.

## 보고 내용과 집계

각 문제의 **재현 방법은 필수 구역**으로 별도 페이지에 표시합니다. 시작 페이지·브라우저·화면 크기·시작 조건,
번호별 실제 행동과 테스트 입력값, 기대 결과·최초 관찰 결과를 포함합니다. 추가 재현의 시도·결과는 따로 표시합니다.
자료가 없더라도 이 구역을 생략하지 않으며, `재현 방법 보완 필요`와 누락 사유를 표시합니다.
입력값은 비밀값 제외 처리를 거친 원문을 유지하며 상태 코드처럼 번역하지 않습니다.
빈 inputs 배열은 입력 기록이 없다는 의미이며 입력이 불필요했다는 증명은 아닙니다.
CLI의 `reproduction_warnings`에도 절차 누락·실행 미확인·민감 입력 제외를 기록합니다.

1. 실행 ID·사이트·시작/종료 시각·종료 이유·브라우저·화면 크기와 집계.
2. 검사 항목별 페이지·완료/미완료 상태·사유, 문제 목록.
3. 문제별 기대·근거·실제 결과, 시작 조건·실제 행동 순서·입력값, 추가 재현 결과.
4. 최초 발견/추가 재현별 스크린샷·로그·문제 및 행동 ID 연결.

`checks`의 고유 ID 수가 검사 기록 수입니다. `completed`만 완료이며 나머지는 미완료·미확인에 포함합니다.
페이지 수는 검사 기록에 전달된 비어 있지 않은 URL의 고유 개수입니다. 사이트 전체 페이지 수가 아닙니다.
`findings`의 고유 ID 수는 **문제 기록 수**이며 확정 버그 수가 아닙니다. 판정 상태를 목록·상세에 따로 표시합니다.
`confirmed`만 시스템 확인 수로 세고 사람의 최종 확인으로 표현하지 않습니다.
동일 ID 중복은 오류이며, 동일 문제의 반복 발견·재현에 새 finding ID를 발급하지 않을 책임은 생산자에게 있습니다.
페이지가 다르거나 기대 조건이 다른 사례는 별도 ID로 전달합니다. 보고서가 의미를 추측해 병합하지 않습니다.

## 누락·실패·비밀값 처리

- 구조 필드는 필수입니다. 아직 얻지 못한 내용은 `null`, 해당 상태는 `unknown`/`not_run`, 기록 목록은 `[]`로 전달합니다.
- `unknown_reasons`에 JSON Pointer 경로별 미확인 사유를 적습니다. 사유도 없으면 "앞단에서 값과 미확인 사유를 전달하지 않음"으로 출력합니다.
- 알 수 없는 스키마·상태·중복 ID·끊어진 참조는 입력 오류로 중단합니다. 기존 PDF와 원본은 보존합니다.
- 증거 누락·손상·안전 검토 미완료는 PDF 내 경고로 남기고 가능한 보고를 계속합니다. 촬영 실패를 사이트 버그로 바꾸지 않습니다.
- 텍스트는 공유 가능한 값만 전달해야 합니다. 추가로 민감 입력, 대표적인 자격증명 패턴, URL 사용자 정보·쿼리·fragment를 제거합니다.
- `inputs[].sensitive: true` 또는 비밀값으로 보이는 입력 이름의 값은 제외합니다. 비밀값을 예시에 넣어 전달할 필요는 없습니다.
- 이미지·로그는 생산자가 비밀값을 제거하고 검토한 후에만 `share_safe: true`로 표시합니다. 기본적으로 자동 OCR·화면 비밀값 제거는 하지 않습니다. 임의 본문의 모든 비밀값을 자동 탐지한다고 보장하지 않습니다.
- JSON 최대 10 MB, 증거 파일 최대 15 MB, 이미지 최대 2천만 화소. 로그는 첫 12,000자를 표시하고 생략 사실을 안내합니다.

## 검증

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m wtp_report --write-schema report-input.schema.json
.\.venv\Scripts\python.exe scripts/render_preview.py output/pdf/demo-report.pdf
```

테스트는 집계, 참조, 재현 기록, 비밀값, 경로 제한, 한글 PDF, 부분 결과와 긴 텍스트, 증거 손상, 원본 보존을 확인합니다.
샘플 PDF는 별도로 페이지를 이미지로 렌더링하여 시각 검수합니다. PDF 렌더링 검수 의존성인 PyMuPDF와 pypdf는 실제 보고서 생성에는 필요하지 않습니다.
