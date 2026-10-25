/** 저장소 안의 원본 데이터. 화면으로 나가는 모양은 views.ts 가 만든다. */

export interface User {
  id: string;
  name: string;
  /** 전화번호·이메일 인증으로만 가입한 계정은 비밀번호가 없다. */
  salt: string | null;
  passwordHash: string | null;
  /** 숫자만 (01012345678) */
  phone: string | null;
  /** 소문자 */
  email: string | null;
  createdAt: number;
  /** 자기소개. 200자까지 */
  bio: string;
  /** 프로필 사진 주소. 없으면 화면이 이름으로 기본 그림을 만든다. */
  avatar: string | null;
  prefs: UserPrefs;
  /** 가입할 때 고른 성별. 건너뛰었으면 null. 다른 사람에게는 보이지 않는다. */
  gender: "male" | "female" | "nonbinary" | null;
  /** 관심 항목 id (interests.ts) */
  interests: string[];
}

export interface UserPrefs {
  /** 내 글·댓글에 답글이 달리면 알림 */
  replyNotifications: boolean;
  /** 운영진 조치(삭제·활동 정지) 알림 */
  modNotifications: boolean;
  /** 다른 사람이 나에게 쪽지를 보낼 수 있다. */
  allowMessages: boolean;
}

/** 글에 붙은 이미지 한 장. 크기를 같이 저장해 두면 화면이 자리를 미리 잡아 덜컹거리지 않는다. */
export interface PostImage {
  src: string;
  width: number;
  height: number;
  /** 화면 낭독기가 읽는 설명 */
  alt: string;
  caption: string;
}

/** 사용자가 올린 파일. 글·프로필·커뮤니티 설정에서 ID 로 가리킨다. */
export interface Upload {
  id: string;
  ownerId: string;
  mime: string;
  data: Buffer;
  width: number;
  height: number;
  /** 동영상 길이(초). 이미지는 null */
  duration: number | null;
  createdAt: number;
}

/** 전화번호·이메일 인증번호 한 건 */
export interface OtpChallenge {
  id: string;
  channel: "phone" | "email";
  target: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  /** 이 시각 전에는 다시 보내기를 할 수 없다. */
  resendAfter: number;
  attempts: number;
  verifiedAt: number | null;
  /** 가입까지 끝나서 다시 쓸 수 없다. */
  used: boolean;
}

export interface Community {
  /** 주소에 쓰는 이름. /c/{name} */
  name: string;
  /** 화면에 보이는 이름 */
  title: string;
  description: string;
  rules: string[];
  /** 말머리. 비어 있으면 말머리를 쓰지 않는다. */
  flairs: string[];
  /** true 면 글을 쓸 때 말머리를 반드시 골라야 한다. */
  requireFlair: boolean;
  /**
   * 공개 범위.
   *   public      누구나 보고 쓸 수 있다
   *   restricted  누구나 볼 수 있지만 운영진만 글을 쓴다
   *   private     회원 · 운영진만 보고 쓴다. 스스로 가입할 수 없다
   */
  access: CommunityAccess;
  /** 성인용(18+) 커뮤니티. 인기 피드 · 추천에서 빠진다. */
  mature: boolean;
  moderatorIds: string[];
  /** 커뮤니티 아이콘·배너 이미지 주소 */
  icon: string | null;
  banner: string | null;
  /** 배너가 없을 때 쓰는 대표 색 (#rrggbb) */
  color: string;
  /** 이 커뮤니티와 맞는 관심 항목 id (interests.ts). 추천에 쓴다. */
  topics: string[];
  /** 시드 데이터용 가상 회원 수. 실제 가입자는 여기에 더한다. */
  baseMembers: number;
  createdAt: number;
}

export interface Post {
  id: string;
  community: string;
  authorId: string;
  title: string;
  body: string;
  url: string | null;
  /** 비어 있으면 글, 한 장 이상이면 이미지 글(여러 장이면 갤러리) */
  images: PostImage[];
  /** 동영상 글이면 동영상 한 개 (이미지와 같이 쓰지 않는다) */
  video: PostVideo | null;
  /** 스포일러. 목록 · 글 화면에서 내용을 가렸다가 누르면 보여 준다. */
  spoiler: boolean;
  flair: string | null;
  createdAt: number;
  editedAt: number | null;
  /** 시드 데이터용 가상 점수. 실제 투표는 여기에 더한다. */
  baseScore: number;
  pinned: boolean;
  /** 작성자가 지웠다. */
  deleted: boolean;
  /** 운영진이 지웠다. */
  removed: boolean;
}

/** 비공개 커뮤니티 가입 요청 */
export interface JoinRequest {
  id: string;
  community: string;
  userId: string;
  message: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  /** 거절 이유 (선택) */
  reason: string;
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
}

/** 비공개 커뮤니티 초대. 대기 중이어도 expiresAt 이 지나면 만료로 본다. */
export interface Invite {
  id: string;
  community: string;
  userId: string;
  invitedBy: string;
  message: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
}

/** 임시 저장. 쓰다 만 글이라 제목 · 커뮤니티가 비어 있을 수 있다. */
export interface Draft {
  id: string;
  userId: string;
  community: string | null;
  title: string;
  body: string;
  url: string;
  flair: string | null;
  spoiler: boolean;
  images: { upload: string; alt: string; caption: string }[];
  /** 동영상 업로드 ID */
  video: string | null;
  updatedAt: number;
}

export interface PostVideo {
  src: string;
  width: number;
  height: number;
  /** 초 */
  duration: number;
}

export interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  authorId: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  baseScore: number;
  deleted: boolean;
  /** 운영진이 지웠다. */
  removed: boolean;
}

export type NotificationType =
  | "post_reply" | "comment_reply" | "mod_removed" | "banned" | "unbanned"
  // 비공개 커뮤니티 회원 받기 (features/membership.ts)
  | "join_request" | "join_approved" | "join_denied" | "invited" | "member_removed";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  /** 알림을 일으킨 사람. 운영진 조치는 커뮤니티 이름으로 보여 주므로 비어 있을 수 있다. */
  actorId: string | null;
  community: string;
  postId: string | null;
  commentId: string | null;
  /** 미리보기 문구 */
  text: string;
  createdAt: number;
  readAt: number | null;
}

export interface Message {
  id: string;
  fromId: string;
  toId: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}

export type ReportReason = "spam" | "harassment" | "misinformation" | "rule" | "other";

export interface Report {
  id: string;
  targetType: "post" | "comment";
  targetId: string;
  community: string;
  reporterId: string;
  reason: ReportReason;
  /** reason 이 rule 일 때 커뮤니티 규칙 번호 (0부터) */
  ruleIndex: number | null;
  detail: string;
  createdAt: number;
  status: "open" | "approved" | "removed";
  resolvedBy: string | null;
  resolvedAt: number | null;
}

export interface Ban {
  community: string;
  userId: string;
  reason: string;
  /** null 이면 영구 */
  until: number | null;
  byId: string;
  createdAt: number;
}

export type VoteDir = 1 | -1;

/** 게임 한 개에 대한 한 사람의 기록. best 는 적을수록 좋은 횟수 (아직 이긴 적 없으면 null) */
export const COMMUNITY_ACCESS = ["public", "restricted", "private"] as const;
export type CommunityAccess = (typeof COMMUNITY_ACCESS)[number];

export interface GameRecord {
  best: number | null;
  bestAt: number | null;
  plays: number;
  lastAt: number;
}
