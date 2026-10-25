/**
 * 결함 한 건의 형식. Maison 과 같은 모양을 쓴다.
 * 형식이 갈리면 groundTruth() 가 읽지 못하므로 타입으로 못 박는다.
 */

export type BugArea =
  | "functional" // 기능적    — F
  | "validation" // 입력 검증  — V
  | "routing" // 이동·라우팅 — N
  | "ui"; // UI        — U

export type BugSymptom =
  | "no_response" // 눌러도 아무 일이 없다
  | "partial" // 데이터는 바뀌었는데 화면 일부가 안 따라간다
  | "false_result" // 결과와 메시지가 어긋난다
  | "duplicate" // 같은 동작이 여러 번 실행된다
  | "wrong_target" // 엉뚱한 곳으로 이동한다
  | "visual"; // 보이는 모양이 잘못됐다

export interface Bug {
  id: string;
  area: BugArea;
  symptom: BugSymptom;
  title: string;
  description: string;
  location: string;
  reproduce: string;
  /** 그 화면의 정답을 적어 넣지 않은 범용 규칙으로 잡히는가 */
  detectable: boolean;
  needs: string[];
}
