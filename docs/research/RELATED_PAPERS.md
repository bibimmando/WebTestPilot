# WebTestPilot 프로젝트 관련 논문 정리

영어 원문 없이 방법과 적용 흐름을 자세히 이해하려면 [한국어 상세 가이드](PAPERS_GUIDE_KO.md)를 읽으면 된다. 논문별 사례·설계 연결·검증 방법을 별도 문서에 정리했다.

조사일: 2026-10-08. 논문 원문·저자 공개본·공식 학회 및 대학 저장소를 기준으로 확인했다. 성능 수치는 저자들의 실험 결과이며 이 프로젝트의 측정값이 아니다.

프로젝트 맥락은 [공용 통합 가이드](../INTEGRATION_GUIDE.md)와 [팀원 1 전처리기 안내](../../teams/member-01/README.md)를 기준으로 했다. 현재 연결 흐름은 URL 순회 → 페이지 상태·AI 입력 수집 → AI 검사 콜백 → 조작 전후 증거 → 판정·보고서다. 검사 유형은 기능, 입력 검증, 라우팅, UI다. 전처리·증거 수집 구현과 AI 판정·보고서 구현 완료는 구분해야 한다.

## 테스트 오라클이란?

테스트 오라클(test oracle)은 **관찰한 실행 결과가 기대한 동작에 맞는지 판단하는 기준 또는 절차**다. 특정 제품 이름이 아니다. 입력이나 행동을 자동으로 만드는 문제와, 그 결과가 옳은지 판단하는 문제는 별개다. 명세가 부족하면 일부 동작만 판정하는 부분 오라클을 사용할 수 있다. [Barr 외, 2015](https://discovery.ucl.ac.uk/id/eprint/1471263/)

이 프로젝트에 맞춘 예를 들면 다음과 같다. 아래 사례는 논문의 실험 사례가 아니라 설명용 예시다.

| 테스트에서 한 일 | 오라클이 확인할 내용 | 필요한 근거 |
|---|---|---|
| 검색 버튼 클릭 | 검색 조건에 맞는 결과가 표시되는가? | 검색 규칙, 테스트 데이터, 결과 상태 |
| 필수 입력을 비우고 제출 | 명시된 입력 제약대로 제출이 제한되는가? | HTML 제약 또는 요구사항, 실제 폼 반응 |
| 장바구니에 상품 추가 | 선택한 상품과 수량이 기대대로 반영되는가? | 상품·수량 규칙, 조작 전후 상태 |
| 다른 화면으로 이동 | 기대한 목적지와 화면 내용에 도달했는가? | 링크 목적지·요구사항, 최종 URL·화면 |

Playwright의 클릭 완료만으로 해당 기능의 통과를 판정할 수는 없다. 현재 통합 가이드도 행동 완료, 검사 통과, 버그 확정을 구분한다.

## 선정한 6편

| 논문·도구 | 발표 | 주로 해결하는 문제 | 프로젝트에서 읽을 담당 |
|---|---|---|---|
| WebTestPilot | FSE 2026 / PACMSE | 요구사항에서 오라클 추론, 상태 간 검증 | AI 검사·판정, 벤치마크 |
| The Oracle Problem in Software Testing: A Survey | IEEE TSE 2015 | 오라클의 개념, 종류, 명세 부족 문제 | 전원, 특히 AI 판정 |
| AutoE2E | ICSE 2025 | 기능 발견, 의미 있는 테스트 흐름 생성 | AI 검사 계획, 벤치마크 |
| ATUSA / Invariant-Based Automatic Testing | IEEE TSE 2012 | UI 상태 탐색, 불변식으로 자동 판정 | 크롤링·전처리, 규칙 검사 |
| WebExplor | ICSE 2021 | 다단계 행동과 새로운 상태 탐색 | 크롤링·행동 실행 |
| Metamorphic Testing 리뷰 | ACM Computing Surveys 2018 | 정확한 정답이 없을 때 관계로 검증 | 입력 검증·기능 판정 |

### 1. WebTestPilot — 오라클 설계에 가장 직접적인 논문

**WebTestPilot: Agentic End-to-End Web Testing against Natural Language Specification by Inferring Oracles with Symbolized GUI Elements** — Xiwen Teoh 외, FSE 2026 / Proceedings of the ACM on Software Engineering, Vol. 3. [원문](https://arxiv.org/html/2602.11724v3) · [서지·PDF](https://arxiv.org/abs/2602.11724) · [공식 코드·벤치마크](https://github.com/code-philia/WebTestPilot)

- **핵심:** 자연어 요구사항을 단계로 나누고, GUI의 주요 데이터를 기호·변수로 표현한다. 각 행동의 사전·사후 조건을 만들며 이전 상태와 현재 상태의 데이터·시간·인과 관계를 검증한다.
- **보고된 결과:** 테스트 흐름 완료율 99%, 버그 탐지 precision 96%, recall 96%. 네 웹앱의 100개 요구사항과 주입 결함을 사용한 벤치마크다. [실험 원문](https://arxiv.org/html/2602.11724v3#S5)
- **적용 아이디어:** `snapshot_id`와 `action_id`로 이전 상태의 값을 연결하고, AI가 제안한 기대 결과를 관찰된 값에 대한 검사로 구체화한다.
- **차이와 한계:** 논문은 자연어 요구사항을 입력받으며 요구사항의 완결성을 가정한다. URL에서 기능을 발견하는 우리 목표에 적용하려면 기대 결과의 근거를 얻는 과정이 추가로 필요하다. [문제 정의·한계](https://arxiv.org/html/2602.11724v3)
- **읽을 부분:** §4.2 Oracle Inference, §4.3 Oracle Execution, §5.1 Benchmark Construction, §5.3 Bug Detection.

### 2. The Oracle Problem in Software Testing: A Survey — 기본 개념과 설계 근거

**The Oracle Problem in Software Testing: A Survey** — Earl T. Barr, Mark Harman, Phil McMinn, Muzammil Shahbaz, Shin Yoo. IEEE Transactions on Software Engineering 41(5), 507–525, 2015. DOI: `10.1109/TSE.2014.2372785`. 온라인 공개는 2014년, 권·호 기준 출판연도는 2015년이다. [대학 저장소](https://discovery.ucl.ac.uk/id/eprint/1471263/) · [공개 PDF](https://discovery.ucl.ac.uk/id/eprint/1471263/1/06963470.pdf)

- **핵심:** 명세 기반 오라클, 실행·문서에서 유도하는 오라클, 관계를 활용한 부분 오라클, 사람의 판정과 비용 등을 정리한 서베이다. 전체 기대 동작을 몰라도 판정 가능한 부분을 검사할 수 있다.
- **프로젝트 연결:** `expected_result`와 `expectation_source`를 함께 기록하는 이유, 근거가 부족하면 판정 불가를 남기는 이유를 설명하는 이론적 근거다.
- **적용 아이디어:** 요구사항·HTML 제약·명시적 안내·검증된 상태 관계를 구분해서 기대 결과의 출처를 기록한다. AI가 만든 추정은 관찰 사실과 구분한다.
- **한계:** LLM 이전 연구다. AI 모델의 환각·비용에 대한 최신 실험 근거로 사용하기보다는 오라클의 정의와 분류를 설명할 때 적합하다.
- **읽을 부분:** §2 Definitions, §4 Specified Test Oracles, §5 Derived Test Oracles, §6 Implicit Test Oracles.

### 3. AutoE2E — URL에서 기능과 테스트 흐름을 발견하는 방향에 가까움

**Feature-Driven End-To-End Test Generation** — Parsa Alian 외, ICSE 2025. 최초 arXiv 공개는 2024년이며 이 정리는 2025년 수정본을 참고했다. [원문](https://arxiv.org/html/2408.01894v2) · [PDF 안내](https://arxiv.org/abs/2408.01894) · [공식 학회 페이지](https://conf.researchr.org/details/icse-2025/icse-2025-research-track/61/Feature-Driven-End-To-End-Test-Generation)

- **핵심:** 페이지 문맥과 행동을 바탕으로 애플리케이션 기능을 추론하고, 해당 기능을 수행하는 행동 흐름을 테스트로 만든다. 여러 관찰에서 발견한 기능을 모으고 기능·행동 관계를 연결한다.
- **보고된 결과:** 8개 오픈소스 웹앱으로 구성한 E2EBench에서 평균 feature coverage 79%. 이는 **버그 탐지율이나 판정 정확도가 아니다.** [평가·정의](https://arxiv.org/html/2408.01894v2)
- **프로젝트 연결:** `feature_candidates`를 다단계 검사 계획으로 발전시키고, 같은 기능의 반복 발견을 묶는 데 참고할 수 있다. 입력은 스크린샷·앱 설명·이전 행동 등을 활용하므로 현재 compact JSON 입력과 동일하지 않다.
- **한계:** 논문의 중심은 기능 발견과 테스트 생성이다. 결론에서 assertion generation을 후속 연구로 제시하므로, 정확한 버그 판정까지 완성한 기법으로 소개하면 안 된다. [결론](https://arxiv.org/html/2408.01894v2#S8)
- **읽을 부분:** §II Feature-Driven E2E Testing, §III-C Feature Inference, §III-D Feature Aggregation, §IV Benchmark Construction.

### 4. ATUSA — 상태 기반 크롤러와 규칙 오라클의 연결

**Invariant-Based Automatic Testing of Modern Web Applications** — Ali Mesbah, Arie van Deursen, Danny Roest. IEEE Transactions on Software Engineering 38(1), 35–53, 2012. [저자 공개 PDF](https://people.ece.ubc.ca/amesbah/resources/papers/tse11.pdf) · [저자 논문 목록](https://people.ece.ubc.ca/amesbah/www/papers/)

- **핵심:** 크롤러로 동적인 UI 상태와 전이를 탐색하고 state-flow graph를 만든다. DOM과 상태 전이에 관한 불변식, 즉 적용 조건에서 유지돼야 하는 성질을 오라클로 사용한다. 공통 규칙과 애플리케이션별 규칙을 함께 지원한다.
- **프로젝트 연결:** 같은 URL 안의 탭·모달·폼 반응도 별도 상태로 다뤄야 하는 이유를 설명한다. 현재 URL 그래프와 조작 전후 snapshot을 앞으로 상태 그래프로 연결할 때 참고할 수 있다.
- **적용 아이디어:** 근거가 있는 DOM·입력 제약은 규칙으로 검사하고, 문맥이 필요한 기대 결과는 AI에 맡기는 구조를 설계한다.
- **한계:** 공통 규칙만으로 모든 업무 로직을 검증하지는 못한다. 애플리케이션별 불변식과 입력 설정에는 사람의 작업이 필요하며 LLM 자동 추론 기법은 아니다.
- **읽을 부분:** §4 Deriving AJAX States와 불변식 검사·테스트 생성 관련 §5–6.

### 5. WebExplor — 다단계 기능에 도달하는 탐색 전략

**Automatic Web Testing using Curiosity-Driven Reinforcement Learning** — Yan Zheng 외, ICSE 2021. [논문·PDF 안내](https://arxiv.org/abs/2103.06018) · [PDF](https://arxiv.org/pdf/2103.06018) · [공식 학회 페이지](https://conf.researchr.org/details/icse-2021/icse-2021-papers/21/Automatic-Web-Testing-using-Curiosity-Driven-Reinforcement-Learning)

- **핵심:** 새로운 상태·행동을 찾아가는 호기심 기반 강화학습과, 실행 중 점진적으로 만드는 상태 전이 모델을 결합한다. 입력 후 제출처럼 여러 행동을 거쳐야 도달하는 화면을 탐색한다.
- **보고된 결과:** 상용 웹앱에서 개발자가 확인하고 수정한 미지의 failure 12개를 보고했다. 논문의 자동 failure 기준에는 JS 예외와 클라이언트·서버 오류가 포함된다. [문제 정의·실험](https://arxiv.org/pdf/2103.06018)
- **프로젝트 연결:** 링크 수집만으로 도달하기 어려운 상태를 찾고, 반복 행동에 탐색 예산을 소모하는 문제를 다루는 데 적합하다.
- **적용 아이디어:** 초기에는 전체 강화학습을 구현하기보다 미실행 행동·새 상태 발견 여부를 기록하고 단순 탐색 전략과 비교할 수 있다. 이는 프로젝트에 대한 제안이다.
- **한계:** 예외·HTTP 오류 중심의 failure 탐지와 업무 규칙의 정확한 검증은 구분해야 한다. 우리 기능 판정에는 별도의 의미적 오라클이 필요하다.
- **읽을 부분:** §II-B Problem Formulation, §III Automatic Web Testing.

### 6. Metamorphic Testing 리뷰 — 정답 전체를 몰라도 관계를 검사

**Metamorphic Testing: A Review of Challenges and Opportunities** — Tsong Yueh Chen 외. ACM Computing Surveys 51(1), Article 4, 2018. DOI: `10.1145/3143561`. [대학 저장소·초록](https://acquire.cqu.edu.au/articles/journal_contribution/Metamorphic_testing_A_review_of_challenges_and_opportunities/13446482) · [출판사](https://doi.org/10.1145/3143561)

- **핵심:** 단일 입력의 정확한 정답을 얻기 어려울 때, 여러 입력과 출력 사이에 유지돼야 하는 관계를 검사한다. 관계의 식별, 테스트 생성, 적용·평가의 문제를 정리한 서베이다.
- **프로젝트 연결:** 기대 결과의 전체 값을 모르더라도, 근거가 있는 관계를 기능·입력 검사에 활용할 수 있다.
- **설명용 적용 예시:** 정렬이 항목 순서만 바꾸도록 명세돼 있다면 정렬 전후의 전체 항목 집합은 같아야 한다. 필터가 동일 데이터 집합에 조건을 추가하는 방식이라면 전체 결과는 기존 결과의 부분집합이어야 한다. 페이지 분할이 있다면 현재 화면 일부만 비교해서는 안 된다.
- **한계:** 관계 자체가 해당 서비스의 명세와 맞아야 한다. 실시간 데이터 변경·페이지 분할 등 전제 조건을 확인해야 하며, 관계를 통과했다고 모든 기능이 정확하다는 뜻은 아니다.
- **읽을 부분:** Introduction과 metamorphic relation 식별·검증 관련 논의.

## 이 프로젝트에 적용하는 순서

다음은 논문 요약을 바탕으로 한 설계 제안이며 현재 구현 완료를 뜻하지 않는다.

1. **기대 결과의 근거부터 기록한다.** 현재 계획 초안의 `expected_result`, `expectation_source`, `observe`를 활용한다. HTML 제약은 브라우저 입력 검증의 근거가 될 수 있지만 서버의 모든 업무 규칙을 설명하지는 않는다. 근거가 없으면 검사 목적과 관찰 결과를 남기고 판정을 보류한다.
2. **각 판정을 조작과 상태에 연결한다.** 기대 결과, 실제 관찰, `action_id`, 조작 전후 `snapshot_id`를 함께 기록한다. 상태 변화와 오류 이벤트가 보였다는 사실만으로 행동의 인과관계나 결함을 확정하지 않는다.
3. **기능 발견과 버그 판정을 나눠 평가한다.** 기능을 많이 발견해도 오탐이 많을 수 있고, 정확하게 판정해도 탐색 범위가 좁을 수 있다. 두 성능을 따로 보여준다.
4. **입력 압축의 효과를 같은 증거로 비교한다.** 동일한 저장 snapshot으로 상세 입력과 compact 입력의 검사 계획·판정을 비교한다. 요약에서 생략한 정보로 생긴 미탐과, 절감한 입력 토큰·비용을 함께 본다. 필요한 상세를 `get_element()`로 다시 조회하는 조건도 기록한다.

현재 콜백의 `test_status`는 `passed`, `failed`, `not_run`이다. 통합 가이드에 따라 판정 불가·미실행 사유는 상세 결과에 남긴다. 논문을 참고한다고 이 enum이나 공통 계약을 바로 변경할 필요는 없다.

## 벤치마크에서 분리해 볼 지표

| 평가 축 | 측정할 내용 | 참고 논문 |
|---|---|---|
| 탐색 | 도달한 의미 있는 상태, 실행한 행동, 수행한 기능의 범위 | ATUSA, WebExplor, AutoE2E |
| 판정 | 고유 결함 단위 precision·recall·F1, 정상 동작에 대한 오탐 | WebTestPilot, Oracle Survey |
| 불확실성 | 미실행·판정 불가 건수와 사유 | 프로젝트 통합 계약 |
| 재현 | 초기화한 환경에서 같은 절차로 다시 확인되는 비율 | 프로젝트 재현 기준 |
| 비용 | 입력·출력 토큰, 호출 수, 시간, 실제 비용 | 프로젝트 측정 계획 |
| 압축 영향 | 상세 입력 대비 요약 입력의 근거 보존·오탐·미탐 변화 | 프로젝트 측정 계획 |

Precision은 보고한 결함 중 실제 결함의 비율, recall은 평가 대상 실제 결함 중 찾아낸 비율이다. 분모가 0이면 별도 표시한다. 같은 원인의 반복 로그를 여러 결함으로 세지 않는다.

정답 목록은 평가기에만 제공하고 검사 AI의 입력에서는 숨긴다. 정상 모드와 결함 모드를 둘 다 포함한다. 서비스의 정상 동작, 환경 실패, 도구 실행 실패를 구분할 수 있도록 초기 상태·기대 결과·재현 절차를 기록한다. 이는 현재 공용 통합 가이드의 벤치마크 계약에도 맞는다.

## 읽기 우선순위와 프로젝트 설명

시간이 적으면 **WebTestPilot → Oracle Survey → AutoE2E** 순서로 읽는다. 크롤링 담당자는 ATUSA와 WebExplor를 추가로, 판정 담당자는 Metamorphic Testing 리뷰를 추가로 읽으면 좋다.

프로젝트의 연구 방향은 다음처럼 설명할 수 있다.

> 웹 UI에서 기능과 테스트 흐름을 발견하고, 규칙·상태 관계·AI 추론으로 기대 결과를 구성한 뒤, 조작 전후 증거로 버그 후보를 판정하는 시스템을 개발한다. 압축된 페이지 입력이 탐색·판정 성능과 모델 비용에 미치는 영향을 측정한다.

이는 현재 목표를 정리한 제안 문장이다. 자체 벤치마크가 나오기 전에는 높은 정확도·비용 절감 효과나 기존 연구 대비 우수성을 성과로 주장하지 않는다.
