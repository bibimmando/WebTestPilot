import type { Bug } from "./types";

/**
 * 입력 검증 결함. ID 접두사 V.
 *
 * 이 파일은 입력 검증 결함 담당자만 건드린다. 다른 분야의 레지스트리를
 * 열지 않으면 브랜치를 합칠 때 충돌이 나지 않는다.
 */
export const validationBugs: Bug[] = [
  {
    id: "V1",
    area: "validation",
    symptom: "false_result",
    title: "하이픈을 넣은 휴대전화 번호를 거부함",
    description:
      "전화번호 입력 칸의 안내는 '010-1234-5678' 형식인데, 서버가 하이픈을 떼지 않고 검사해서 " +
      "하이픈을 넣은 번호를 '휴대전화 번호를 확인해 주세요. 예: 010-1234-5678' 로 거부한다. " +
      "거부 메시지의 예시가 방금 넣은 형식과 같다. 숫자만 넣으면 통과한다.",
    location: "server/otp.ts normalizeTarget (휴대전화)",
    reproduce:
      "로그아웃 상태에서 로그인 > '전화번호로 계속하기' 에 010-1111-1111 을 넣고 인증번호 받기를 누른다. " +
      "거부된다. 01011111111 로 넣으면 인증번호가 오고 alice 로 로그인된다.",
    detectable: false,
    needs: ["ai"],
  },
  {
    id: "V2",
    area: "validation",
    symptom: "false_result",
    title: "한글이 들어간 링크 주소를 거부함",
    description:
      "링크 주소 검사 정규식이 영어 · 숫자 · 일부 기호만 받는다. https:// 로 시작하는 올바른 주소라도 " +
      "경로나 도메인에 한글이 있으면 'http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.' 로 거부한다. " +
      "영어로만 된 주소는 통과한다.",
    location: "server/api.ts POST /api/posts (링크)",
    reproduce:
      "로그인한 뒤 글쓰기에서 커뮤니티를 고르고 제목을 쓴 다음, 링크 붙이기에 " +
      "https://ko.wikipedia.org/wiki/서울 을 넣고 등록한다. 거부된다. https://example.com/seoul 은 등록된다.",
    detectable: false,
    needs: ["ai"],
  },
];
