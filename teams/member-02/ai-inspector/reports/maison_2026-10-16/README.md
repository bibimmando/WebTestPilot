# Maison Sonnet 점검 공유 결과

실험일: 2026-10-16 KST. **총 17종 중 6종(35.3%)을 프로그램의 추가 재현 기준으로 확인**했습니다. 기존 3종에서 F1·F3·N1이 추가됐습니다.

| ID | 확인한 증상 | 대표 증거 |
|---|---|---|
| F1 | 저장 개수는 1인데 위시리스트 항목 내용 누락 | [최초 판정](evidence/F1/finding.json) · [추가 재현](evidence/F1/reproduction.json) |
| F2 | 성공 알림 뒤 실제 장바구니가 비어 있음 | [직접 링크 클릭 검사](evidence/F2/scenario_results.json) · [추가 재현](evidence/F2/reproduction.json) |
| F3 | 수량 plus 클릭 전후 1→1 유지 | [조건별 평가](evidence/F3/judgment_assessment.json) · [실제 대상](evidence/F3/execution_audit.json) · [재현](evidence/F3/reproduction.json) |
| F4 | ALL을 눌러도 컬렉션 필터가 해제되지 않음 | [최초 판정](evidence/F4/finding.json) · [추가 재현](evidence/F4/reproduction.json) |
| N1 | 연관 카드의 이름·가격과 실제 상품 불일치 | [실제 클릭 대상](evidence/N1/execution_audit.json) · [추가 재현](evidence/N1/reproduction.json) |
| U5 | 고정 헤더가 제목·브레드크럼을 가림 | [원본/재현 이미지 참조](evidence/U5/reproduction.json) |

나머지 11종은 V1~V5, N3/N4, U1~U4입니다. 미실행·검사 조건 부족·증거 부족을 포함하며 정상 판정이라는 뜻은 아닙니다. [17종 대조](confirmation_audit.json), [평가용 버그 목록](evaluation/bugs.json).

## 실험 수치

- 기존과 같은 29개 URL, 본 검사 29 flow와 독립 후속 2 flow, 총 89개 시나리오.
- 최초 후보 12건, 프로그램 confirmed 기록 9건. 동일 버그 반복과 finding/버그 ID 단위를 구분해 6종으로 집계.
- passed 46, candidate 12, inconclusive 26, finding 등록 거절 2, 수용 판정 없음 3.
- 본 검사 약 24분 21초. 프로그램/판정 소스를 실행 중 변경하지 않음.
- 199회 모델 요청, 기록된 입력 10,032,226 / 출력 119,257 토큰. 사용량 누락 1회.
- 입력 $2/M·출력 $10/M 기록 단가 기준 약 $21.2570이며 실제 청구서 금액은 아님. [단가 출처](pricing_reference.json), [집계](summary.json).
- 입력 증거 확대와 중복 전달로 이전 전체 검사 $8.53보다 증가. 판정 입력 압축·캐싱·금액 상한은 후속 작업.

## 증거의 범위

F1은 DOM·텍스트 기반이며 목록 본문의 이미지 확인은 못했습니다. 지연 로딩·수집 누락 가능성을 원문에 보존했습니다. F2의 대표 증거는 이전 집중 검사의 실제 장바구니 링크 클릭 결과입니다. 이번 전체 검사의 일부 F2는 직접 navigate를 사용한 제한이 있어 이 대표를 함께 제공합니다.

F3은 같은 시나리오의 F2와 별개로 수량 증가 조건의 unmet 및 동일 재현을 확인했습니다. [초기 전체 화면](evidence/F3/images/initial_full_page.png)에서 수량 버튼의 위치·아이콘을 볼 수 있습니다. 단순한 부가 설명을 별도 버그로 세지 않았습니다. U5의 제목 간격 관련 부가 설명은 추가 버그로 세지 않았습니다.

각 evidence 폴더에는 해당 판정의 계획, 실제 행동, 조건별 평가, 전후 스냅샷, AI 관찰, 이미지가 있습니다. JSON은 배포용으로 중복 관찰·개인 파일 경로·원시 HTML/JS 자료를 줄인 사본입니다. 재현 모델 응답과 결과는 그대로 보존했고 전후 관찰은 snapshot ID로 연결합니다. [원본 파일 해시](original_file_hashes.json), [기준 판정 목록](baseline.json), [당시 실행 코드 해시](execution_source.json).

전체 로컬 원본 결과 디렉토리를 Git에 포함하지는 않았습니다. 이 묶음은 6종의 대표 근거와 당시 집계를 검토하기 위한 자료입니다. 새 모델 실행에서 같은 발견 수나 비용을 보장하지 않습니다. 실행 조건·코드 검증·실제 재검사는 [REPRODUCE.md](../../REPRODUCE.md)를 참고하세요.
