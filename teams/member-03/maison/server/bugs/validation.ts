import type { Bug } from "./types";

/**
 * 입력 검증 버그. ID 접두사는 V 다.
 *
 * 이 파일은 입력 검증 버그 담당자만 건드린다. 다른 분야의 레지스트리를
 * 열지 않으면 브랜치를 합칠 때 충돌이 나지 않는다.
 *
 * 형식은 types.ts 의 Bug 를 따른다. 빠진 항목이 있으면 빌드가 멈춘다.
 */
export const validationBugs: Bug[] = [
  {
    id: "V1", area: "validation", symptom: "false_result",
    title: "BUG-001 주문 이메일 형식 검증 누락",
    description: "형식이 잘못된 이메일로 주문이 접수된다. 과거 V3.",
    location: "src/pages/Checkout.tsx",
    reproduce: "/checkout에서 다른 필수값은 정상, 이메일은 invalid-address로 제출",
    detectable: false, needs: ["ui_validity", "order_state"],
  },
  {
    id: "V2", area: "validation", symptom: "false_result",
    title: "BUG-002 계정 이름 공백 저장",
    description: "스페이스 3개가 저장되어 재조회 시 이름이 비어 있다. 과거 V6.",
    location: "server/bugs/validation-behavior.ts",
    reproduce: "로그인 후 /account에서 이름을 스페이스 3개로 저장하고 새로고침",
    detectable: false, needs: ["state_comparison"],
  },
  {
    id: "V3", area: "validation", symptom: "false_result",
    title: "BUG-004 배송 도시 빈값 수용",
    description: "도시를 비워도 주문이 접수된다. 과거 V7.",
    location: "src/pages/Checkout.tsx",
    reproduce: "/checkout에서 정상 이메일 및 다른 필수값을 채우고 City만 비워 제출",
    detectable: false, needs: ["ui_validity", "order_state"],
  },
  {
    id: "V4", area: "validation", symptom: "false_result",
    title: "BUG-005 재설정 암호 확인 불일치 수용",
    description: "확인값과 달라도 첫 번째 암호로 재설정된다. 과거 V9.",
    location: "src/pages/ResetPassword.tsx",
    reproduce: "새 유효 링크에서 FirstPass!123 / OtherPass!456을 입력하고 제출",
    detectable: false, needs: ["ui_error", "subsequent_login"],
  },
  {
    id: "V5", area: "validation", symptom: "false_result",
    title: "BUG-003 정확히 8자인 가입 암호 거부",
    description: "8자인 가입 암호가 weak_password로 거부된다. 과거 V11.",
    location: "server/bugs/validation-behavior.ts",
    reproduce: "/signup에서 새 이메일, 정상 이름, Ab12!xyz로 가입",
    detectable: false, needs: ["boundary_comparison", "http_error"],
  },
];
