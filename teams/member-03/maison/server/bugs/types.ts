/**
 * 버그 한 건의 형식.
 *
 * 네 분야의 담당자가 각자 레지스트리 파일에 적는데, 형식이 갈리면
 * groundTruth() 가 읽지 못해 리포트에 빈칸이 생긴다. 문서로 약속해 두면
 * 지켜지지 않아도 아무 일이 일어나지 않으므로, 타입으로 못 박아
 * 빌드 단계에서 걸리게 한다.
 */

export type BugArea =
  | "functional" // 기능적    — F
  | "validation" // 입력 검증  — V
  | "routing" // 이동·라우팅 — N
  | "ui"; // UI        — U

export type BugSymptom =
  | "no_response" // 눌러도 아무 일이 없다
  | "partial" // 데이터는 바뀌었는데 화면 일부가 안 따라간다
  | "false_result" // 결과와 메시지가 어긋난다 (거짓 성공·거짓 실패)
  | "duplicate" // 같은 동작이 여러 번 실행된다
  | "wrong_target" // 엉뚱한 곳으로 이동한다
  | "visual"; // 보이는 모양이 잘못됐다

export interface Bug {
  /** 접두사가 분야를 뜻한다. F1, V1, N1, U1 — 담당자끼리 겹치지 않는다. */
  id: string;

  area: BugArea;
  symptom: BugSymptom;

  /** 한 줄 제목. 리포트의 항목명이 된다. */
  title: string;

  /** 무슨 일이 일어나는가. 증상만 적고 원인은 적지 않는다. */
  description: string;

  /** 심은 자리. "src/pages/Checkout.tsx" 처럼 파일 경로. */
  location: string;

  /** 어떤 순서로 하면 재현되는가. 검사기가 도달해야 할 경로이기도 하다. */
  reproduce: string;

  /**
   * 규칙만으로 잡히는가.
   *
   * 이 값은 "이렇게 될 것이다"라는 선언이고, 벤치마크가 실제 결과와
   * 대조한다. 틀려도 된다. 틀린 게 드러나는 것이 측정의 목적이다.
   */
  detectable: boolean;

  /**
   * 잡으려면 무엇이 필요한가.
   *   "http_error" "console_error" "js_exception" "broken_resource"
   *   "horizontal_scroll" "duplicate_post" "no_state_change" "ai"
   */
  needs: string[];
}
