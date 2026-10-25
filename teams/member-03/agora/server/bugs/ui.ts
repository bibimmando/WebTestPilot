import type { Bug } from "./types";

/**
 * UI 결함. ID 접두사 U.
 *
 * 이 파일은 UI 결함 담당자만 건드린다. 다른 분야의 레지스트리를
 * 열지 않으면 브랜치를 합칠 때 충돌이 나지 않는다.
 *
 * 두 건 모두 데이터와 동작은 정상이고 화면 표시만 틀린다.
 */
export const uiBugs: Bug[] = [
  {
    id: "U1",
    area: "ui",
    symptom: "visual",
    title: "댓글을 신고하는데 창 제목이 '글 신고하기'",
    description:
      "글과 댓글이 신고 창 하나를 같이 쓰는데, 제목을 정할 때 '댓글' 구분을 보지 않아 " +
      "댓글의 '신고' 를 눌러도 제목이 '글 신고하기' 로 나온다. 신고 자체는 댓글로 제대로 접수된다.",
    location: "src/components/ReportDialog.tsx",
    reproduce:
      "로그인한 뒤 아무 글에서 다른 사람 댓글의 '신고' 를 누른다. 창 제목이 '댓글 신고하기' 가 아니라 '글 신고하기' 다. " +
      "글 오른쪽 위 메뉴의 '신고' 로 연 창은 '글 신고하기' 로 같다.",
    detectable: false,
    needs: ["ai"],
  },
  {
    id: "U2",
    area: "ui",
    symptom: "partial",
    title: "알림을 읽어도 종 아이콘의 빨간 숫자가 그대로",
    description:
      "알림을 읽음 처리한 뒤 머리글의 읽지 않은 알림 수를 다시 불러오지 않는다. 알림 목록은 모두 읽음으로 바뀌고 " +
      "알림 화면 머리글의 숫자도 줄어드는데, 종 아이콘의 빨간 숫자는 그대로 남는다. 새로고침하거나 " +
      "다른 동작(가입 · 글쓰기 등)으로 로그인 정보를 다시 받으면 맞춰진다.",
    location: "src/components/NotificationMenu.tsx, src/pages/NotificationsPage.tsx",
    reproduce:
      "alice 로 로그인한다(읽지 않은 알림이 있다). 종 아이콘을 눌러 '모두 읽음' 을 누르거나 알림 하나를 연다. " +
      "목록은 읽음으로 바뀌는데 종 아이콘의 숫자는 줄지 않는다.",
    detectable: false,
    needs: ["ai"],
  },
];
