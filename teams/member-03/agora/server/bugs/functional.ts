import type { Bug } from "./types";

/**
 * 기능적 결함. ID 접두사 F.
 *
 * 이 파일은 기능 결함 담당자만 건드린다. 다른 분야의 레지스트리를
 * 열지 않으면 브랜치를 합칠 때 충돌이 나지 않는다.
 *
 * 네 건 모두 한 화면만 봐서는 정상처럼 보이고, 여러 단계 · 여러 계정을 오가며
 * 앞뒤 상황을 맞춰 봐야 드러난다.
 */
export const functionalBugs: Bug[] = [
  {
    id: "F1",
    area: "functional",
    symptom: "partial",
    title: "탈퇴한 커뮤니티의 글이 홈 피드에 계속 나옴",
    description:
      "홈 피드가 로그인하는 순간의 가입 목록을 다음 로그인까지 계속 쓴다. 커뮤니티에서 탈퇴해도 " +
      "홈 머리글의 '가입한 커뮤니티 N곳' 과 가입 칩 줄은 하나 줄어드는데, 피드에는 그 커뮤니티 글이 " +
      "계속 섞여 나온다. 반대로 새로 가입한 곳의 글은 나오지 않는다. 로그아웃 후 다시 로그인하면 맞춰진다.",
    location: "server/api.ts listPosts (feed=home)",
    reproduce:
      "bob 으로 로그인한 뒤 c/games 에서 '가입됨' 을 눌러 탈퇴하고 홈으로 간다. " +
      "머리글은 가입한 곳이 하나 줄었는데 피드에 c/games 글이 그대로 있다 (첫 화면에 2개).",
    detectable: false,
    needs: ["ai"],
  },
  {
    id: "F2",
    area: "functional",
    symptom: "partial",
    title: "다른 계정의 '최근 본 글' 이 보임",
    description:
      "최근 본 글의 기록 이름을 아이디가 아니라 회원/손님 구분으로만 만든다. 같은 브라우저에서 " +
      "로그아웃하고 다른 계정으로 들어오면, 앞 계정이 본 글이 홈 오른쪽 '최근 본 글' 에 그대로 나온다. " +
      "손님 기록은 정상처럼 따로 남는다 (로그아웃한 손님 화면에는 나오지 않는다).",
    location: "src/lib/recent.ts",
    reproduce:
      "alice 로 로그인해 글 두 개를 연다. 로그아웃하고 같은 창에서 bob 으로 로그인해 홈을 연다. " +
      "bob 이 본 적 없는 alice 의 최근 본 글이 오른쪽에 있다.",
    detectable: false,
    needs: ["ai"],
  },
  {
    id: "F3",
    area: "functional",
    symptom: "false_result",
    title: "답글 알림을 꺼도 '내 댓글에 달린 답글' 알림은 계속 옴",
    description:
      "설정의 '답글 알림' 은 '내 글에 댓글, 내 댓글에 답글이 달리면 알려 드려요' 라고 하는데, " +
      "끄면 '내 글에 달린 댓글' 알림만 멈추고 '내 댓글에 달린 답글' 알림은 계속 쌓인다. " +
      "설정 확인이 알림 종류 하나에만 들어가 있다.",
    location: "server/notify.ts",
    reproduce:
      "carol 로 설정 > 알림에서 '답글 알림' 을 끈다. 다른 계정(bob)으로 carol 의 댓글에 답글을 단다. " +
      "carol 의 알림에 '내 댓글에 답글을 남겼어요' 가 새로 와 있다.",
    detectable: false,
    needs: ["ai"],
  },
  {
    id: "F4",
    area: "functional",
    symptom: "false_result",
    title: "활동 정지된 사용자가 답글은 달 수 있음",
    description:
      "활동 정지 검사가 새 댓글에만 걸리고 답글(다른 댓글에 다는 댓글)에는 빠져 있다. " +
      "정지 안내는 '글과 댓글을 쓸 수 없어요' 인데, 답글로 달면 그대로 등록되어 모두에게 보인다.",
    location: "server/api.ts POST /api/posts/:id/comments",
    reproduce:
      "시드에서 dave 는 c/food 에서 활동 정지 상태다. dave 로 c/food 글에 새 댓글을 달면 거부된다. " +
      "같은 글의 다른 사람 댓글에서 '답글' 을 눌러 달면 등록된다.",
    detectable: false,
    needs: ["ai"],
  },
];
