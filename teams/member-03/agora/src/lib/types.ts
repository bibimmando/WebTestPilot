/** 서버 views.ts 가 내보내는 모양과 맞춘다. */

export type Vote = 1 | 0 | -1;

export interface Unread {
  notifications: number;
  messages: number;
}

export interface Me {
  name: string;
  avatar: string | null;
  karma: { post: number; comment: number };
  createdAt: string;
  moderates: string[];
  joined: string[];
  /** 관심 항목 id. 바뀌면 추천 커뮤니티를 다시 받는다. */
  interests: string[];
  unread: Unread;
}

export type CommunityAccess = "public" | "restricted" | "private";

export interface Community {
  name: string;
  title: string;
  description: string;
  rules: string[];
  flairs: string[];
  requireFlair: boolean;
  /** public: 누구나 · restricted: 운영진만 글쓰기 · private: 회원만 보고 쓰기 */
  access: CommunityAccess;
  restricted: boolean;
  /** 성인용(18+) */
  mature: boolean;
  /** 글을 볼 수 있는지 (비공개 커뮤니티의 비회원이면 false) */
  canView: boolean;
  /** 비공개 커뮤니티의 비회원일 때만: 내 가입 요청 · 받은 초대 */
  membership: Membership | null;
  icon: string | null;
  banner: string | null;
  /** 배너가 없을 때 쓰는 대표 색 */
  color: string;
  /** 맞는 관심 항목 id */
  topics: string[];
  /** 말머리 원문 → 화면 이름 (영어 화면이면 번역) */
  flairLabels: Record<string, string>;
  /** 번역 전 원문. 운영 설정 화면은 이것을 고친다. */
  source: { title: string; description: string; rules: string[] };
  moderators: string[];
  members: number;
  createdAt: string;
  joined: boolean;
  isModerator: boolean;
  postCount: number;
  /** 운영진에게만 숫자, 나머지는 null */
  openReports: number | null;
  /** 내가 이 커뮤니티에서 활동 정지 중이면 그 내용 */
  myBan: { reason: string; until: string | null } | null;
}

export interface PostImage {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
}

export interface Post {
  id: string;
  community: string;
  communityTitle: string;
  communityIcon: string | null;
  author: string | null;
  authorAvatar: string | null;
  title: string;
  body: string;
  url: string | null;
  images: PostImage[];
  /** 동영상 글이면 동영상 (이미지와 같이 쓰지 않는다) */
  video: PostVideo | null;
  /** 스포일러면 목록 · 글 화면에서 내용을 가렸다가 누르면 보여 준다 */
  spoiler: boolean;
  /** 영어 화면에서 미리 옮겨 둔 번역이 있으면. 화면은 번역을 먼저 보여 주고 "원문 보기" 를 단다. */
  translated: { title: string; body: string; images: { alt: string; caption: string }[] } | null;
  flair: string | null;
  flairLabel: string | null;
  createdAt: string;
  editedAt: string | null;
  score: number;
  myVote: Vote;
  commentCount: number;
  pinned: boolean;
  deleted: boolean;
  removed: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  canReport: boolean;
  saved: boolean;
  hidden: boolean;
}

export interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  author: string | null;
  authorAvatar: string | null;
  body: string;
  translated: string | null;
  createdAt: string;
  editedAt: string | null;
  score: number;
  myVote: Vote;
  deleted: boolean;
  removed: boolean;
  isPostAuthor: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReport: boolean;
  children: Comment[];
}

export interface Listing {
  items: Post[];
  hasMore: boolean;
  nextOffset: number;
  total: number;
}

export interface UserInfo {
  name: string;
  avatar: string | null;
  bio: string;
  karma: { post: number; comment: number };
  createdAt: string;
  isMe: boolean;
  canMessage: boolean;
  moderates: string[];
}

export interface UserProfile {
  user: UserInfo;
  posts: Post[];
  comments: (Omit<Comment, "children"> & { postTitle: string; community: string })[];
}

export type NotificationType =
  | "post_reply" | "comment_reply" | "mod_removed" | "banned" | "unbanned"
  | "join_request" | "join_approved" | "join_denied" | "invited" | "member_removed";

export interface AppNotification {
  id: string;
  type: NotificationType;
  actor: string | null;
  actorAvatar: string | null;
  community: string;
  post: { id: string; title: string; community: string } | null;
  commentId: string | null;
  text: string;
  createdAt: string;
  read: boolean;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  mine: boolean;
  body: string;
  createdAt: string;
  read: boolean;
}

export interface Conversation {
  with: string;
  avatar: string | null;
  last: Message;
  unread: number;
}

export type ReportReason = "spam" | "harassment" | "misinformation" | "rule" | "other";

export interface Report {
  id: string;
  type: "post" | "comment";
  post: Post;
  comment: Omit<Comment, "children"> | null;
  targetAuthor: string;
  /** 삭제된 뒤에도 볼 수 있는 원문 */
  original: string;
  reporter: string;
  reason: ReportReason;
  rule: string | null;
  detail: string;
  createdAt: string;
  status: "open" | "approved" | "removed";
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface Ban {
  user: string;
  avatar: string | null;
  reason: string;
  until: string | null;
  by: string;
  createdAt: string;
}

export interface Settings {
  name: string;
  avatar: string | null;
  bio: string;
  email: string | null;
  phone: string | null;
  hasPassword: boolean;
  prefs: { replyNotifications: boolean; modNotifications: boolean; allowMessages: boolean };
  gender: Gender | null;
  interests: string[];
}

export type Gender = "male" | "female" | "nonbinary";

export interface InterestCategory {
  id: string;
  label: string;
  items: { id: string; label: string; emoji: string }[];
}

export interface UploadResult {
  id: string;
  url: string;
  width: number;
  height: number;
  /** 동영상 길이(초). 이미지는 null */
  duration: number | null;
  kind: "image" | "video";
}

export interface PostVideo {
  src: string;
  width: number;
  height: number;
  duration: number;
}

/** 임시 저장 (서버 features/drafts.ts) */
export interface Draft {
  id: string;
  community: string | null;
  title: string;
  body: string;
  url: string;
  flair: string | null;
  spoiler: boolean;
  images: { upload: string; alt: string; caption: string; src: string; width: number; height: number }[];
  video: { upload: string; src: string; width: number; height: number; duration: number | null } | null;
  updatedAt: string;
}

export interface Recommendations {
  /** 관심 항목을 기준으로 골랐는지 (아니면 인기 순) */
  basedOnInterests: boolean;
  items: { community: Community; reason: "interest" | "popular"; matched: { id: string; label: string }[] }[];
}

export interface Game {
  id: string;
  title: string;
  tagline: string;
  howTo: string;
  color: string;
  /** 기록 단위. 둘 다 적을수록 좋다. */
  unit: "tries" | "moves";
  min: number;
  max: number;
  monthlyPlayers: number;
  /** 로그인하지 않았으면 null */
  me: { best: number | null; plays: number; rank: number | null } | null;
}

export interface GameDetail {
  game: Game;
  /** 서버가 정해 둔 게임 시드 (POST /_reset { seed } · AGORA_SEED). 없으면 null */
  seed: number | null;
  leaderboard: { rank: number; name: string; avatar: string | null; best: number; plays: number }[];
}

/** 비공개 커뮤니티에서 보는 사람 자신의 상태 (서버 membership-state.ts) */
export interface Membership {
  request: { status: "pending"; createdAt: string } | null;
  /** 거절된 뒤 다시 요청할 수 있는 시각. 지금 보낼 수 있으면 null */
  retryAt: string | null;
  denyReason: string;
  invite: { id: string; invitedBy: string | null; message: string; expiresAt: string } | null;
  banned: boolean;
}

export interface JoinRequestItem {
  id: string;
  user: string;
  avatar: string | null;
  message: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  reason: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface InviteItem {
  id: string;
  user: string;
  avatar: string | null;
  invitedBy: string | null;
  message: string;
  createdAt: string;
  expiresAt: string;
}

export interface MemberItem {
  name: string;
  avatar: string | null;
  moderator: boolean;
}
