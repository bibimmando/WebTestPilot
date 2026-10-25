import { seedGames } from "./features/games";
import { notify } from "./notify";
import { MEDIA, VIDEOS, type MediaKey, type VideoKey } from "./seed-media";
import {
  DEFAULT_PREFS,
  castVote,
  clearAll,
  db,
  hashPassword,
  membersOf,
  nextCommentId,
  nextMessageId,
  nextPostId,
  nextReportId,
  nextUserId,
  setOf,
} from "./store";
import type { PostImage, ReportReason } from "./types";

/**
 * 시드 데이터. 매번 같은 상태에서 시작하도록 고정한다.
 * 시각은 "지금으로부터 몇 분 전" 으로 적어서, 언제 띄워도 정렬 결과가 같은 모양이 된다.
 */

export const SEED_PASSWORD = "Test!2345678";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** 시드 계정. 아이디·비밀번호 외에 전화번호·이메일 인증으로도 로그인할 수 있다. */
const USERS: { name: string; phone: string; email: string; bio: string; avatar: MediaKey | null; interests: string[] }[] = [
  { name: "alice", phone: "01011111111", email: "alice@agora.test", avatar: "u_alice", bio: "프론트엔드 개발자. 개발 · 공지 커뮤니티 운영진이에요. 주말엔 제주 올레길 걷기.", interests: ["programming", "ai", "hiking", "kpop", "stocks", "pets"] },
  { name: "bob", phone: "01022222222", email: "bob@agora.test", avatar: "u_bob", bio: "사이드 프로젝트 만드는 걸 좋아합니다. 게임 커뮤니티 운영 중. 강아지 사진은 우리 집 콩이.", interests: ["console_games", "esports", "programming", "stocks", "pets", "movies", "photography"] },
  { name: "carol", phone: "01033333333", email: "carol@agora.test", avatar: "u_carol", bio: "먹고 걷고 기록합니다. 맛집 · 여행 커뮤니티 운영진.", interests: ["restaurants", "cooking", "coffee", "overseas_travel", "photography", "running", "reading"] },
  // dave 는 프로필 사진도 관심 항목도 없다 — 기본 그림 · 빈 상태가 보이는 경우
  { name: "dave", phone: "01044444444", email: "dave@agora.test", avatar: null, bio: "", interests: [] },
];

interface CommunitySeed {
  name: string;
  title: string;
  description: string;
  rules: string[];
  flairs: string[];
  requireFlair?: boolean;
  restricted?: boolean;
  mods: string[];
  members: string[];
  baseMembers: number;
  ageDays: number;
  color: string;
  topics: string[];
}

const COMMUNITIES: CommunitySeed[] = [
  {
    name: "dev",
    title: "개발",
    description: "프로그래밍, 개발 문화, 커리어 이야기를 나눕니다.",
    rules: ["서로 존중해 주세요.", "질문에는 시도해 본 내용을 같이 적어 주세요.", "홍보 글은 '프로젝트' 말머리로만 올려 주세요."],
    flairs: ["질문", "정보", "프로젝트", "잡담"],
    mods: ["alice"],
    members: ["alice", "bob", "dave"],
    baseMembers: 12_480,
    ageDays: 300,
    color: "#4f46e5",
    topics: ["programming", "ai", "pc_hardware"],
  },
  {
    name: "games",
    title: "게임",
    description: "PC·콘솔·모바일 게임 이야기",
    rules: ["스포일러는 제목에 [스포] 를 붙여 주세요.", "불법 다운로드 공유는 금지입니다."],
    flairs: ["리뷰", "뉴스", "질문", "잡담"],
    mods: ["bob"],
    members: ["alice", "bob", "dave"],
    baseMembers: 30_215,
    ageDays: 280,
    color: "#7c3aed",
    topics: ["pc_games", "console_games", "mobile_games", "esports", "indie_games", "board_games", "models"],
  },
  {
    name: "food",
    title: "맛집",
    description: "직접 다녀온 맛집과 집밥 레시피",
    rules: ["직접 방문한 곳만 올려 주세요.", "협찬 받은 글은 밝혀 주세요."],
    flairs: ["서울", "경기", "지방", "레시피"],
    mods: ["carol"],
    members: ["bob", "carol"],
    baseMembers: 8_760,
    ageDays: 210,
    color: "#ea580c",
    topics: ["restaurants", "cooking", "baking", "coffee", "drinks"],
  },
  {
    name: "travel",
    title: "여행",
    description: "국내외 여행 후기와 계획",
    rules: ["다른 사람 얼굴이 나온 사진은 가려 주세요."],
    flairs: ["국내", "해외", "질문"],
    mods: ["carol"],
    members: ["alice", "carol"],
    baseMembers: 6_420,
    ageDays: 190,
    color: "#0891b2",
    topics: ["domestic_travel", "overseas_travel", "camping", "hiking"],
  },
  {
    name: "ask",
    title: "무엇이든 물어보세요",
    description: "생활·공부·진로, 무엇이든 물어보고 답해 주세요.",
    rules: ["질문 글은 말머리를 꼭 골라 주세요.", "해결되면 말머리를 '해결됨' 으로 바꿔 주세요."],
    flairs: ["질문", "해결됨"],
    requireFlair: true,
    mods: ["dave"],
    members: ["carol", "dave"],
    baseMembers: 15_890,
    ageDays: 260,
    color: "#059669",
    topics: ["campus", "languages", "personal_finance"],
  },
  {
    name: "notice",
    title: "Agora 공지",
    description: "사이트 운영 공지입니다. 운영진만 글을 쓸 수 있어요.",
    rules: ["공지에 대한 의견은 댓글로 남겨 주세요."],
    flairs: ["공지"],
    restricted: true,
    mods: ["alice"],
    members: ["alice"],
    baseMembers: 41_000,
    ageDays: 320,
    color: "#1e3a8a",
    topics: [],
  },
  // ── 관심 항목 분류에 맞춰 늘린 커뮤니티 ───────────────────
  {
    name: "stocks", title: "주식·재테크", description: "주식, 코인, 부동산, 재테크 이야기를 나눠요. 투자 권유는 금지예요.",
    rules: ["특정 종목 매수·매도 권유 금지", "수익 인증은 '인증' 말머리로 올려 주세요.", "리딩방·유료 정보 홍보 금지"],
    flairs: ["주식", "코인", "부동산", "질문", "인증"], mods: ["bob"], members: ["bob", "dave"],
    baseMembers: 52_300, ageDays: 240, color: "#0f766e", topics: ["stocks", "crypto", "real_estate", "personal_finance", "economy"],
  },
  {
    name: "movies", title: "영화·드라마", description: "영화, 드라마, 예능, 애니메이션 감상과 추천",
    rules: ["스포일러는 제목에 [스포] 를 붙여 주세요.", "불법 링크 공유 금지"],
    flairs: ["영화", "드라마", "예능", "애니", "추천"], mods: ["carol"], members: ["carol", "alice"],
    baseMembers: 27_900, ageDays: 230, color: "#be123c", topics: ["movies", "dramas", "variety", "anime", "webtoon"],
  },
  {
    name: "music", title: "음악", description: "K-POP 부터 클래식까지, 듣고 연주하는 모든 음악",
    rules: ["음원 불법 공유 금지"],
    flairs: ["K-POP", "힙합", "인디", "클래식", "추천"], mods: ["alice"], members: ["alice", "bob"],
    baseMembers: 19_400, ageDays: 220, color: "#9333ea", topics: ["kpop", "hiphop", "indie_music", "classical"],
  },
  {
    name: "sports", title: "스포츠", description: "축구 · 야구 · 농구 경기 이야기",
    rules: ["상대 팀 팬 비하 금지", "경기 중 실시간 글은 '경기' 말머리로 올려 주세요."],
    flairs: ["축구", "야구", "농구", "경기"], mods: ["dave"], members: ["dave", "bob"],
    baseMembers: 33_100, ageDays: 200, color: "#15803d", topics: ["soccer", "baseball", "basketball"],
  },
  {
    name: "fitness", title: "운동", description: "헬스, 러닝, 홈트레이닝 기록과 질문",
    rules: ["몸 사진은 '인증' 말머리로 올려 주세요.", "부상·질병은 전문가와 상담하세요."],
    flairs: ["헬스", "러닝", "질문", "인증"], mods: ["dave"], members: ["dave", "alice"],
    baseMembers: 14_200, ageDays: 180, color: "#dc2626", topics: ["fitness", "running", "hiking"],
  },
  {
    name: "pets", title: "반려동물", description: "우리 집 아이 자랑하고 돌보는 정보를 나눠요.",
    rules: ["동물 학대 영상 금지", "분양 · 판매 글 금지"],
    flairs: ["강아지", "고양이", "정보", "자랑"], mods: ["bob"], members: ["bob", "carol"],
    baseMembers: 24_800, ageDays: 170, color: "#d97706", topics: ["pets"],
  },
  {
    name: "memes", title: "유머", description: "웃긴 글, 밈, 짤",
    rules: ["퍼온 글은 출처를 밝혀 주세요.", "특정인 비하 금지"],
    flairs: ["밈", "짤", "썰"], mods: ["bob"], members: ["bob", "alice", "dave"],
    baseMembers: 61_500, ageDays: 160, color: "#ca8a04", topics: ["memes", "funny", "variety"],
  },
  {
    name: "gadgets", title: "전자기기", description: "스마트폰, 노트북, 웨어러블 리뷰와 질문",
    rules: ["제품 홍보 · 판매 금지"],
    flairs: ["리뷰", "질문", "뉴스"], mods: ["alice"], members: ["alice", "bob"],
    baseMembers: 21_700, ageDays: 150, color: "#475569", topics: ["gadgets", "smartphones", "pc_hardware", "ai"],
  },
  {
    name: "career", title: "취업·커리어", description: "취업, 이직, 자격증, 외국어 공부",
    rules: ["회사 실명 비방 금지", "합격 후기는 '후기' 말머리로 올려 주세요."],
    flairs: ["취업", "이직", "자격증", "외국어", "후기"], mods: ["dave"], members: ["dave", "alice"],
    baseMembers: 18_600, ageDays: 140, color: "#2563eb", topics: ["jobs", "certificates", "languages", "campus"],
  },
  {
    name: "photo", title: "사진", description: "직접 찍은 사진과 그림을 나눠요.",
    rules: ["직접 찍은 사진만 올려 주세요.", "촬영 정보(카메라 · 렌즈)를 적어 주세요."],
    flairs: ["풍경", "인물", "거리", "장비"], mods: ["carol"], members: ["carol", "alice"],
    baseMembers: 16_300, ageDays: 130, color: "#0e7490", topics: ["photography", "drawing"],
  },
  {
    name: "life", title: "라이프", description: "패션, 뷰티, 인테리어, 육아 이야기",
    rules: ["광고 · 협찬 글은 밝혀 주세요."],
    flairs: ["패션", "뷰티", "인테리어", "육아"], mods: ["carol"], members: ["carol"],
    baseMembers: 12_900, ageDays: 120, color: "#db2777", topics: ["fashion", "beauty", "interior", "parenting"],
  },
  {
    name: "books", title: "독서", description: "읽은 책 이야기와 추천",
    rules: ["줄거리 스포일러는 [스포] 를 붙여 주세요."],
    flairs: ["추천", "리뷰", "질문"], mods: ["alice"], members: ["alice"],
    baseMembers: 9_800, ageDays: 110, color: "#78350f", topics: ["reading"],
  },
];

/** [작성자, 본문, 부모보다 몇 분 뒤, 점수, 답글] */
type CommentSeed = [string, string, number, number, CommentSeed[]?];

interface PostSeed {
  c: string;
  by: string;
  title: string;
  body?: string;
  url?: string;
  /** [이미지, 설명(alt), 캡션] */
  images?: [MediaKey, string, string][];
  video?: VideoKey;
  flair?: string;
  /** 지금으로부터 몇 분 전 */
  ago: number;
  score: number;
  pinned?: boolean;
  comments?: CommentSeed[];
}

const POSTS: PostSeed[] = [
  // ── 개발 ──────────────────────────────────────────────
  {
    c: "dev", by: "alice", flair: "정보", ago: 20 * 24 * 60, score: 152, pinned: true,
    title: "개발 커뮤니티 이용 규칙 (필독)",
    body: "안녕하세요, 개발 커뮤니티 운영진입니다.\n\n1. 질문 글에는 무엇을 시도했는지 같이 적어 주세요.\n2. 오류 메시지는 사진 대신 글자로 붙여 주세요.\n3. 홍보 글은 '프로젝트' 말머리를 달아 주세요.\n\n즐거운 커뮤니티를 함께 만들어요.",
    comments: [["dave", "오류 메시지를 글자로 붙여 달라는 거 정말 중요하죠. 검색도 되고요.", 120, 41]],
  },
  {
    c: "dev", by: "carol", flair: "정보", ago: 300, score: 842,
    title: "React 19 에서 바뀐 것 정리해봤습니다",
    body: "주요 변경점만 추렸습니다.\n\n- 폼 처리를 돕는 Actions 가 들어왔어요.\n- use() 로 Promise 를 바로 읽을 수 있어요.\n- ref 를 일반 prop 으로 넘길 수 있게 됐어요.\n\n옮기면서 깨진 부분이 있으면 댓글로 공유해 주세요.",
    comments: [
      ["bob", "ref 를 prop 으로 넘기는 거 너무 반갑네요. forwardRef 지옥에서 탈출...", 25, 134, [
        ["carol", "기존 forwardRef 도 당분간은 동작하니 천천히 바꾸셔도 돼요.", 18, 52],
      ]],
      ["dave", "Actions 는 아직 감이 잘 안 오는데 예제 하나만 부탁드려도 될까요?", 60, 37],
      ["bob", "이런 정리는 제 블로그에 훨씬 자세히 있어요!! 프로필 링크 눌러서 구독 부탁드려요~", 150, -4],
    ],
  },
  {
    c: "dev", by: "dave", flair: "질문", ago: 180, score: 57,
    title: "주니어 개발자 포트폴리오, 무엇을 넣어야 할까요?",
    body: "졸업 프로젝트 두 개, 개인 프로젝트 하나가 있습니다.\n세 개 다 넣는 게 좋을까요, 잘한 것 하나만 깊게 쓰는 게 좋을까요?",
    comments: [
      ["alice", "하나를 깊게 쓰는 걸 추천해요. 무엇을 왜 그렇게 결정했는지가 면접에서 제일 많이 나와요.", 40, 33],
      ["bob", "저는 세 개 다 넣되, 대표 하나만 길게 썼어요.", 70, 12],
    ],
  },
  {
    c: "dev", by: "bob", flair: "프로젝트", ago: 26 * 60, score: 431,
    images: [["app_budget", "가계부 앱 화면 두 개. 왼쪽은 10월 지출 내역 목록, 오른쪽은 분류별 지출 도넛 차트", "왼쪽 내역 화면, 오른쪽 통계 화면이에요"]],
    title: "사이드 프로젝트로 만든 가계부 앱 공개합니다",
    url: "https://example.com/budget-app",
    body: "카테고리별 지출 그래프와 월 예산 알림이 있어요. 피드백 환영합니다!",
  },
  {
    c: "dev", by: "alice", flair: "잡담", ago: 45, score: 12,
    title: "타입스크립트 strict 켜니까 에러가 300개 나왔어요",
    body: "오늘 하루는 이걸로 끝날 것 같네요...",
  },
  {
    c: "dev", by: "carol", flair: "잡담", ago: 2 * 24 * 60, score: 1203,
    title: "코드 리뷰에서 가장 많이 받는 지적은 뭔가요?",
    body: "저는 '이 함수 이름만 보고 뭘 하는지 알 수 있나요?' 를 제일 많이 들어요. 다들 어떤 지적을 자주 받으시나요?",
    comments: [
      ["dave", "변수 이름이요. '이 이름만 보고 뭘 담는지 알 수 있나요?' 를 제일 많이 들었어요.", 30, 412, [
        ["carol", "공감합니다. data, info, temp 같은 이름은 거의 매번 지적받아요.", 20, 188, [
          ["bob", "저는 반대로 이름이 너무 길다는 지적을 받았어요 ㅋㅋ userAccountSettingsUpdateRequestDto...", 15, 96, [
            ["alice", "그건 이름보다 클래스가 너무 많은 일을 한다는 신호일 때가 많더라고요.", 25, 71, [
              ["bob", "맞아요. 결국 나눠서 해결했습니다.", 10, 22],
            ]],
          ]],
        ]],
        ["alice", "리뷰어 입장에서는 이름이 제일 먼저 눈에 들어와서 그런 것 같아요.", 40, 54],
      ]],
      ["bob", "함수가 너무 길다는 지적이요. 한 화면에 안 들어오면 나누라고 하더라고요.", 50, 233, [
        ["dave", "팀마다 기준이 다르던데, 저희는 40줄 넘으면 이유를 적게 해요.", 30, 61],
      ]],
      ["alice", "테스트 없이 올리지 말라는 말이요. 버그 수정 PR 에는 재현 테스트를 같이 넣으라고 합니다.", 70, 305, [
        ["carol", "이거 정말 중요해요. 같은 버그가 두 번 나오는 걸 막아줍니다.", 12, 98],
        ["dave", "재현 테스트를 먼저 쓰면 고친 게 맞는지도 바로 확인되고요.", 35, 44],
      ]],
      ["carol", "주석이 코드랑 안 맞는다는 지적이요. 코드는 고쳤는데 주석은 그대로인 경우가 많아요.", 95, 87],
      ["dave", "PR 이 너무 크다는 지적. 500줄 넘으면 리뷰어가 대충 보게 된대요.", 130, 176, [
        ["bob", "그래서 요즘은 기능 하나도 여러 PR 로 나눠서 올려요.", 20, 33],
      ]],
    ],
  },
  {
    c: "dev", by: "bob", flair: "질문", ago: 540, score: 88,
    title: "SQLite 를 실서비스에 써도 될까요?",
    body: "동시 접속이 많지 않은 사내 도구인데, SQLite 로 충분할지 궁금합니다.",
    comments: [["carol", "쓰기가 몰리지 않으면 충분해요. WAL 모드는 꼭 켜세요.", 50, 46]],
  },
  {
    c: "dev", by: "dave", flair: "질문", ago: 840, score: 156,
    title: "Git rebase 와 merge, 팀에서 뭘 쓰세요?",
    body: "기록이 깔끔한 rebase 와 안전한 merge 사이에서 팀 의견이 갈리네요.",
  },
  {
    c: "dev", by: "bob", flair: "잡담", ago: 20, score: 3,
    title: "오늘 처음으로 PR 이 머지됐어요!",
    body: "오픈소스에 처음 기여해 봤는데 너무 뿌듯하네요.",
  },

  // ── 게임 ──────────────────────────────────────────────
  {
    c: "games", by: "bob", flair: "잡담", ago: 4 * 24 * 60, score: 64, pinned: true,
    title: "이번 주 자유 토론 스레드",
    body: "이번 주에 한 게임, 하고 싶은 게임, 아무 이야기나 자유롭게 남겨 주세요.",
    comments: [["alice", "요즘 퍼즐 게임에 빠졌어요. 머리 쓰는 게 재밌네요.", 300, 12]],
  },
  {
    c: "games", by: "dave", flair: "리뷰", ago: 420, score: 1560,
    title: "오픈월드 RPG 확장팩 엔딩 보고 왔습니다 (스포 없음)",
    body: "본편보다 난이도가 확실히 높고, 보스 패턴이 정말 공들여 만들어져 있어요.\n분량은 본편의 절반 정도로 느껴졌습니다.",
    comments: [
      ["carol", "난이도 때문에 고민 중인데 중간에 포기할 정도인가요?", 35, 88, [
        ["dave", "처음 두 보스만 넘기면 할 만해요. 장비를 꼭 올리고 가세요.", 15, 64],
      ]],
      ["bob", "음악이 정말 좋더라고요.", 80, 41],
      ["alice", "본편 엔딩 안 봤는데 확장팩부터 해도 될까요?", 120, 9],
    ],
  },
  {
    c: "games", by: "alice", flair: "질문", ago: 120, score: 34,
    title: "스토리 좋은 인디 게임 추천 부탁드려요",
    body: "짧더라도 이야기가 기억에 남는 게임을 찾고 있어요.",
    comments: [
      ["bob", "탐험하면서 편지를 모으는 류의 게임 좋아하시면 꼭 해보세요. 두세 시간이면 끝나요.", 30, 21],
      ["carol", "저는 등대지기 이야기 게임이 아직도 생각나요.", 55, 14],
    ],
  },
  {
    c: "games", by: "carol", flair: "뉴스", ago: 30 * 60, score: 978,
    images: [["p158", "무대 조명이 쏟아지는 게임 쇼 현장과 환호하는 관객", "현장 분위기는 이랬어요"]],
    title: "이번 게임 쇼 발표 정리",
    url: "https://example.com/game-show-2026",
    body: "신작 발표, 출시일, 트레일러 링크를 한곳에 모았습니다.",
  },
  {
    c: "games", by: "bob", flair: "잡담", ago: 3 * 24 * 60, score: 210,
    images: [["p96", "어두운 책상 위에 놓인 검은색 게임 패드", "저는 요즘 패드파입니다"]],
    title: "패드 vs 키보드, 여러분은?",
    body: "액션 게임은 패드, 전략 게임은 키보드로 하는데 다들 어떠신가요?",
  },
  {
    c: "games", by: "dave", flair: "질문", ago: 5 * 24 * 60, score: 145,
    title: "로그라이크 입문작 추천해 주세요",
  },

  // ── 맛집 ──────────────────────────────────────────────
  {
    c: "food", by: "carol", flair: "서울", ago: 240, score: 377,
    images: [["p635", "오래된 나무 탁자 위에 놓인 법랑 컵들", "컵까지 옛날 그대로예요"]],
    title: "을지로 노포 국밥집 다녀왔어요",
    body: "40년 된 집이라는데 국물이 정말 깊어요. 점심에는 줄이 길어서 11시 반 전에 가시는 걸 추천합니다.",
    comments: [
      ["bob", "여기 수육도 맛있어요!", 40, 28],
      ["dave", "주차는 되나요?", 90, 6, [["carol", "주차는 안 돼요. 근처 공영주차장 쓰셔야 해요.", 10, 9]]],
    ],
  },
  {
    c: "food", by: "dave", flair: "경기", ago: 2 * 24 * 60, score: 512,
    images: [["p437", "빨간 차양이 늘어선 붉은 벽돌 건물의 식당가", "골목 입구. 저녁엔 줄이 길어요"], ["p999", "어두운 탁자 위에 차려진 디저트와 작은 그릇들", "후식으로 나오는 것까지 정갈해요"]],
    title: "수원 갈비 맛집 정리",
    body: "직접 가본 곳 다섯 군데를 가격과 함께 정리했습니다.",
  },
  {
    c: "food", by: "alice", flair: "레시피", ago: 660, score: 233,
    images: [["p292", "도마 위의 적양파, 파슬리, 통후추 같은 재료", "재료는 이게 전부예요"]],
    title: "10분 만에 만드는 계란볶음밥",
    body: "1. 파기름을 먼저 낸다\n2. 계란을 반쯤 익힌다\n3. 밥을 넣고 센 불에 볶는다\n4. 간장은 팬 가장자리에 둘러 향을 낸다",
  },
  {
    c: "food", by: "bob", flair: "지방", ago: 6 * 24 * 60, score: 98,
    images: [["p428", "노란 벽의 작은 가게 앞에 세워진 자전거", "가게 앞. 아침 7시에 문 열어요"]],
    title: "전주 한옥마을 근처 콩나물국밥",
  },
  {
    c: "food", by: "carol", flair: "지방", ago: 60, score: 15,
    title: "부산 돼지국밥 어디가 제일 맛있나요?",
    body: "다음 주에 부산 가는데 현지인 추천 부탁드려요.",
  },

  // ── 여행 ──────────────────────────────────────────────
  {
    c: "travel", by: "alice", flair: "국내", ago: 480, score: 645,
    images: [["p1057", "바다를 내려다보는 초록 언덕과 해안 절벽", "첫날 · 동쪽 해안 산책로"], ["p603", "파도가 부딪히는 검은 바위 해안", "둘째 날 · 남쪽 바위 해안"], ["p702", "절벽 아래 흰 모래사장과 에메랄드빛 바다", "셋째 날 · 서쪽 해변"], ["p645", "파란 하늘 아래 늘어선 야자수", "마지막 날 · 공항 가는 길"]],
    title: "제주 3박 4일 동선 공유합니다",
    body: "첫날 동쪽, 둘째 날 남쪽, 셋째 날 서쪽으로 돌았어요. 렌터카 없이는 힘든 동선입니다.",
    comments: [
      ["dave", "동선 너무 좋네요. 저장해 갑니다.", 60, 22],
      ["carol", "셋째 날 서쪽 일몰 명소는 어디 가셨어요?", 100, 18, [["alice", "협재 쪽에서 봤어요!", 30, 11]]],
    ],
  },
  {
    c: "travel", by: "dave", flair: "질문", ago: 300, score: 41,
    title: "오사카 처음 가는데 교통패스 뭐가 좋을까요",
  },
  {
    c: "travel", by: "bob", flair: "해외", ago: 4 * 24 * 60, score: 289,
    images: [["p419", "언덕길을 오르는 노란 트램 두 대", "28번 트램은 아침 일찍 타세요"], ["p369", "빨래가 걸린 파스텔색 건물이 늘어선 골목", "알파마 골목"], ["p1065", "좁은 골목 끝으로 보이는 바다", "골목 끝에 바다가 보이는 곳이 많아요"], ["p322", "돌로 포장된 좁은 비탈길과 오래된 벽", "밤에는 이 길이 더 예뻐요"]],
    title: "리스본 혼자 여행 후기",
    body: "언덕이 많아서 편한 신발이 필수예요. 트램 28번은 아침 일찍 타면 한산합니다.",
  },
  {
    c: "travel", by: "carol", flair: "국내", ago: 12 * 24 * 60, score: 120,
    images: [["p870", "파란 하늘을 배경으로 선 흰 등대", "해 질 녘 등대"], ["p521", "바다로 길게 뻗은 흰 난간의 나무 다리", "안목해변 근처 산책로"]],
    title: "강릉 당일치기 코스",
  },

  // ── 무엇이든 물어보세요 ──────────────────────────────────
  {
    c: "ask", by: "bob", flair: "질문", ago: 360, score: 302,
    title: "전세 계약 전에 꼭 확인할 것이 뭘까요?",
    body: "첫 전세 계약을 앞두고 있어요. 놓치기 쉬운 것들 알려주시면 감사하겠습니다.",
    comments: [
      ["carol", "등기부등본은 계약 당일에도 다시 떼 보세요. 그 사이에 바뀔 수 있어요.", 30, 156, [
        ["bob", "당일에도 다시 떼는 건 생각 못 했네요. 감사합니다!", 20, 18],
      ]],
      ["dave", "전입신고와 확정일자는 이사 당일에 바로 하세요.", 45, 121],
    ],
  },
  {
    c: "ask", by: "dave", flair: "질문", ago: 130, score: 18,
    images: [["p3", "나무 책상 위의 노트북과 손에 든 휴대폰", "이 노트북이에요. 3년 썼어요"]],
    title: "노트북이 배터리 50% 에서 갑자기 꺼져요",
    body: "산 지 3년 된 노트북인데 배터리를 바꿔야 할까요?",
  },
  {
    c: "ask", by: "alice", flair: "해결됨", ago: 24 * 60, score: 467,
    title: "자취 첫 달 생활비 얼마나 드나요?",
    body: "답변 감사합니다! 덕분에 예산 잡았어요.",
    comments: [["carol", "월세 빼고 식비·공과금·통신비 합쳐서 70만 원 정도 잡으시면 돼요.", 60, 92]],
  },
  {
    c: "ask", by: "carol", flair: "질문", ago: 900, score: 76,
    title: "영어 회화 독학 방법 추천해 주세요",
  },

  // ── 늘린 커뮤니티의 글 ─────────────────────────────────
  {
    c: "stocks", by: "bob", flair: "질문", ago: 180, score: 88,
    title: "월급 일부를 매달 적립식으로 사는 분들 계신가요?",
    body: "ETF 를 매달 같은 날 사고 있는데, 다들 월급의 몇 퍼센트 정도 넣으시는지 궁금해요.",
    comments: [
      ["dave", "저는 월급의 20% 정도요. 비상금부터 만들고 시작했어요.", 40, 31, [["bob", "비상금은 몇 달 치로 잡으셨어요?", 15, 6, [["dave", "6개월 생활비요.", 10, 9]]]]],
      ["alice", "적립식은 날짜 정해 두고 안 보는 게 제일 편하더라고요", 90, 17],
    ],
  },
  {
    c: "stocks", by: "dave", flair: "부동산", ago: 2 * 24 * 60, score: 154,
    title: "전세 대출 금리 비교해 본 결과 공유합니다",
    body: "은행 세 곳에서 상담을 받아 봤어요.\n\n- A은행: 우대금리를 받으면 제일 낮음\n- B은행: 한도가 넉넉함\n- C은행: 앱으로 서류 제출이 편함\n\n조건마다 달라서 직접 상담 꼭 받아 보세요.",
    comments: [["carol", "정리 감사해요. 우대금리 조건이 뭐였나요?", 120, 12]],
  },
  {
    c: "movies", by: "carol", flair: "추천", ago: 300, score: 302,
    title: "비 오는 주말에 볼 만한 잔잔한 영화 추천해 주세요",
    body: "자극적이지 않고 보고 나면 기분이 좋아지는 영화면 좋겠어요.",
    comments: [
      ["alice", "가족 이야기 다룬 일본 영화들이 잔잔하고 좋아요", 30, 44],
      ["bob", "애니메이션도 괜찮으면 지브리 작품 추천이요", 55, 61, [["carol", "지브리 좋죠! 안 본 게 몇 개 있어서 이번에 봐야겠어요", 20, 12]]],
    ],
  },
  {
    c: "movies", by: "alice", flair: "드라마", ago: 24 * 60, score: 98,
    title: "[스포] 이번 주 드라마 마지막 회 결말 어떻게 보셨어요?",
    body: "열린 결말이라 의견이 갈리는 것 같아요. 저는 나름 만족했어요.",
    comments: [["dave", "저는 조금 아쉬웠어요. 한 회만 더 있었으면", 60, 15]],
  },
  {
    c: "music", by: "alice", flair: "클래식", ago: 540, score: 120,
    images: [["p1082", "건반 위에 놓인 두 손을 흑백으로 찍은 사진", "동네 피아노 학원 발표회 날"]],
    title: "서른 넘어서 피아노 배우기 시작했어요",
    body: "6개월째인데 이제 쉬운 곡은 양손으로 칠 수 있어요. 늦게 시작해도 재밌네요!",
    comments: [["carol", "멋져요! 어떤 곡부터 연습하셨어요?", 45, 18, [["alice", "체르니 100번이랑 쉬운 영화 OST 요", 20, 9]]]],
  },
  {
    c: "music", by: "bob", flair: "K-POP", ago: 120, score: 46,
    title: "요즘 출퇴근길에 듣는 노래 공유해요",
    body: "신곡 위주로 플레이리스트를 만들었는데, 다들 요즘 뭐 들으세요?",
    comments: [["dave", "저는 옛날 노래만 듣게 되더라고요 ㅋㅋ", 30, 8]],
  },
  {
    c: "sports", by: "dave", flair: "축구", ago: 360, score: 210,
    title: "어제 경기 후반전 교체 어떻게 보셨나요",
    body: "전반 내내 밀리다가 교체 후에 분위기가 확 바뀌었어요. 감독 판단이 좋았다고 봅니다.",
    comments: [["bob", "교체 타이밍이 딱 좋았어요", 25, 34]],
  },
  {
    c: "sports", by: "bob", flair: "야구", ago: 3 * 24 * 60, score: 140,
    title: "야구 직관 처음 가는데 좌석 어디가 좋을까요?",
    body: "응원석은 시끄럽다고 들어서 고민이에요.",
    comments: [["dave", "처음이면 1루나 3루 내야석 추천해요. 경기도 잘 보이고 응원도 즐길 수 있어요", 50, 27]],
  },
  {
    c: "fitness", by: "dave", flair: "러닝", ago: 24 * 60, score: 260,
    images: [["p1035", "무지개가 걸린 폭포 앞에서 두 팔을 벌린 사람", "완주 기념으로 여행 왔어요"]],
    title: "첫 하프 마라톤 완주했습니다",
    body: "작년 이맘때는 5km 도 못 뛰었는데 드디어 21km 를 완주했어요. 기록은 2시간 10분!",
    comments: [
      ["alice", "축하해요! 연습은 주에 몇 번 하셨어요?", 30, 22, [["dave", "주 3회, 주말에 장거리 한 번이요", 15, 14]]],
      ["bob", "자극받고 갑니다", 60, 9],
    ],
  },
  {
    c: "fitness", by: "alice", flair: "질문", ago: 420, score: 33,
    title: "헬스장 처음 등록했는데 루틴을 어떻게 짜야 할까요?",
    body: "주 3회 갈 수 있어요. 기구 쓰는 법부터 막막하네요.",
    comments: [["dave", "처음엔 PT 몇 번 받고 기구 사용법을 익히는 게 제일 빨라요", 25, 16]],
  },
  {
    c: "pets", by: "bob", flair: "자랑", ago: 240, score: 680,
    images: [["p237", "나무 바닥에 앉아 위를 올려다보는 검은 강아지", "간식 달라는 눈빛"]],
    title: "우리 집 콩이 소개합니다",
    body: "두 살 된 래브라도예요. 간식 앞에서는 세상 착해집니다.",
    comments: [["carol", "눈빛이 너무 착해요 ㅠㅠ", 10, 45], ["alice", "콩이 이름도 귀엽네요", 30, 21]],
  },
  {
    c: "pets", by: "carol", flair: "고양이", ago: 24 * 60, score: 410,
    images: [["p40", "회색 고양이의 코를 아주 가까이서 찍은 사진", "코만 찍혔어요"]],
    title: "고양이 사진 찍으려고 했는데 코만 나왔어요",
    comments: [["bob", "코가 분홍색이라 귀엽네요 ㅋㅋ", 20, 33]],
  },
  {
    c: "memes", by: "bob", flair: "짤", ago: 110, score: 1240,
    images: [["p433", "정면을 멍하니 바라보는 갈색 곰", ""]],
    title: "월요일 아침 알람 듣고 일어난 내 표정",
    comments: [
      ["alice", "이거 완전 저예요", 5, 312],
      ["dave", "곰도 출근하기 싫구나", 12, 188, [["bob", "곰은 겨울잠이라도 자죠…", 6, 140]]],
    ],
  },
  {
    c: "memes", by: "dave", flair: "썰", ago: 24 * 60, score: 530,
    title: "회사 단톡방에 엄마한테 보낼 메시지 보낸 썰",
    body: "'오늘 저녁 김치찌개 해 줘' 를 팀 단톡방에 보냈습니다.\n팀장님이 '저도 김치찌개 좋아합니다' 라고 답장하셨어요.",
    comments: [["carol", "팀장님 센스 ㅋㅋㅋ", 15, 96]],
  },
  {
    c: "gadgets", by: "alice", flair: "리뷰", ago: 600, score: 175,
    title: "무선 이어폰 6개월 써 본 후기",
    body: "노이즈 캔슬링: 지하철에서 충분\n배터리: 하루 출퇴근이면 넉넉\n아쉬운 점: 바람 불면 통화 품질이 별로\n\n전체적으로 만족해요.",
    comments: [["bob", "통화 품질 아쉬운 거 공감해요", 40, 11]],
  },
  {
    c: "gadgets", by: "bob", flair: "질문", ago: 180, score: 22,
    title: "대학생 노트북 추천 부탁드려요",
    body: "코딩 수업이 있고 가벼웠으면 좋겠어요. 예산은 150만 원 정도예요.",
    comments: [["alice", "메모리 16GB 이상인 걸로 고르세요. 나중에 개발할 때 차이가 커요", 25, 19]],
  },
  {
    c: "career", by: "dave", flair: "이직", ago: 720, score: 190,
    title: "이직 면접에서 받은 질문들 정리",
    body: "1. 지금 회사를 떠나려는 이유\n2. 가장 어려웠던 프로젝트\n3. 팀원과 의견이 다를 때 어떻게 했는지\n\n두 번째 질문에 답을 제일 오래 준비했어요.",
    comments: [["alice", "3번은 거의 매번 나오는 것 같아요", 50, 23]],
  },
  {
    c: "career", by: "alice", flair: "자격증", ago: 2 * 24 * 60, score: 64,
    title: "정보처리기사 실기 공부 어떻게 하셨어요?",
    body: "필기는 붙었는데 실기가 막막하네요.",
    comments: [["dave", "기출 위주로 세 번 돌렸어요. 코드 문제는 손으로 직접 써 보는 게 도움이 됐어요", 90, 20]],
  },
  {
    c: "photo", by: "carol", flair: "풍경", ago: 24 * 60, score: 540,
    images: [
      ["p901", "눈 덮인 산 위로 초록 오로라가 번진 밤하늘", "노출 15초, ISO 1600"],
      ["p903", "은하수 아래 서 있는 사람의 실루엣", "광각 렌즈로 찍었어요"],
    ],
    title: "북유럽 여행에서 찍은 밤하늘",
    body: "삼각대가 없어서 바위에 올려 두고 찍었어요.",
    comments: [["alice", "오로라 실제로 보면 어떤가요?", 40, 26, [["carol", "사진보다 흐릿한데 움직이는 게 신기해요", 30, 18]]]],
  },
  {
    c: "photo", by: "alice", flair: "거리", ago: 360, score: 88,
    images: [["p770", "노을 지는 산 위에서 점프하는 사람의 실루엣", "연사로 찍은 것 중 하나"]],
    title: "타이밍 맞추느라 스무 번 뛰었습니다",
    body: "휴대폰 연사 모드로 찍었어요.",
    comments: [["carol", "구도 너무 좋아요", 20, 14]],
  },
  {
    c: "life", by: "carol", flair: "인테리어", ago: 480, score: 133,
    title: "원룸 좁아 보이지 않게 꾸미는 팁",
    body: "1. 큰 가구는 한쪽 벽으로\n2. 커튼은 천장 가까이 달기\n3. 조명은 간접 조명 두 개\n\n이것만 해도 훨씬 넓어 보여요.",
    comments: [["bob", "커튼 높이 꿀팁이네요", 30, 12]],
  },
  {
    c: "life", by: "alice", flair: "패션", ago: 3 * 24 * 60, score: 47,
    title: "가을 출근룩 다들 어떻게 입으세요?",
    body: "아침저녁으로 추워서 겉옷 고르기가 어려워요.",
    comments: [["carol", "얇은 니트에 트렌치코트 조합을 자주 입어요", 40, 10]],
  },
  {
    c: "books", by: "alice", flair: "추천", ago: 24 * 60, score: 77,
    title: "올해 읽은 책 중에 제일 좋았던 세 권",
    body: "1. 일하는 방식을 다룬 에세이\n2. 우주 이야기를 쉽게 풀어 쓴 과학책\n3. 짧은 소설 모음집\n\n제목은 댓글로 물어보시면 알려 드릴게요.",
    comments: [["dave", "과학책 제목 궁금해요!", 30, 9]],
  },
  {
    c: "books", by: "dave", flair: "질문", ago: 240, score: 12,
    title: "전자책이랑 종이책 중에 어떤 걸 더 많이 보세요?",
    comments: [["alice", "출퇴근엔 전자책, 집에선 종이책이요", 20, 7]],
  },

  // ── 이미지 글 ─────────────────────────────────────────
  {
    c: "games", by: "alice", flair: "잡담", ago: 200, score: 486,
    images: [
      ["p532", "흰 책상 위의 모니터, 스피커, 키보드, 마우스를 위에서 내려다본 모습", "위에서 본 모습"],
      ["p529", "모니터 옆 원목 받침대 위의 흰 스피커와 피규어", "스피커는 중고로 샀어요"],
    ],
    title: "새로 맞춘 책상 세팅 자랑합니다",
    body: "게임도 하고 일도 하는 책상이라 깔끔하게 정리해 봤어요.",
    comments: [
      ["bob", "스피커 어디 건가요? 디자인 예쁘네요", 15, 22, [["alice", "단종된 모델이라 중고로 구했어요 ㅠ", 10, 8]]],
      ["dave", "선 정리 비결 좀 알려 주세요", 40, 11],
    ],
  },
  {
    c: "food", by: "carol", flair: "레시피", ago: 95, score: 154,
    images: [["p1080", "상자 가득 담긴 빨간 딸기", "한 상자에 만 원이었어요"]],
    title: "딸기 철이라 딸기청 담갔어요",
    body: "딸기 1kg, 설탕 1kg. 꼭지 떼고 반으로 잘라 설탕이랑 버무리면 끝이에요. 사흘 뒤부터 먹을 수 있어요.",
    comments: [["alice", "탄산수에 타 먹으면 맛있겠네요!", 20, 9]],
  },
  {
    c: "travel", by: "dave", flair: "국내", ago: 35, score: 27,
    images: [["p705", "주황빛 노을이 번진 구름 사이로 새 한 마리가 나는 하늘", ""]],
    title: "퇴근길 하늘이 너무 예뻐서",
  },
  {
    c: "dev", by: "dave", flair: "질문", ago: 70, score: 19,
    images: [["p42", "창가 쪽 긴 원목 테이블 위에 놓인 커피잔과 휴대폰", "자주 가는 카페. 콘센트가 창가에만 있어요"]],
    title: "카페에서 코딩하시는 분들 콘센트 자리 어떻게 찾으세요?",
    body: "노트북 배터리가 3시간이라 콘센트 없으면 작업이 안 돼요.",
    comments: [["carol", "저는 지도 앱에서 '콘센트' 로 리뷰 검색해요", 12, 14]],
  },

  // ── 공지 ──────────────────────────────────────────────
  {
    c: "notice", by: "alice", flair: "공지", ago: 25 * 24 * 60, score: 88, pinned: true,
    title: "Agora 오픈 안내",
    body: "Agora 가 문을 열었습니다. 관심 있는 커뮤니티에 가입하고 이야기를 나눠 보세요.",
    comments: [
      ["bob", "오픈 축하드려요!", 60, 25],
      ["dave", "커뮤니티는 누구나 만들 수 있나요?", 120, 14, [["alice", "지금은 신청을 받아서 열고 있어요. 공지를 참고해 주세요.", 30, 10]]],
    ],
  },
  {
    c: "notice", by: "alice", flair: "공지", ago: 10 * 24 * 60, score: 40,
    title: "커뮤니티 개설 신청을 받습니다",
    body: "만들고 싶은 커뮤니티의 이름과 소개를 댓글로 남겨 주세요.",
  },
  // ── 동영상 글 ─────────────────────────────────────────
  {
    c: "memes", by: "dave", flair: "밈", ago: 50, score: 640, video: "v_loading_99",
    title: "업데이트 설치할 때 국룰.mp4",
    body: "99%에서 멈추는 건 왜 항상 마지막 1%일까요",
    comments: [
      ["bob", "이거 보다가 결국 재부팅함", 30, 88],
      ["alice", "진행률 표시는 거짓말이다 (개발자 피셜)", 22, 51],
    ],
  },
  {
    c: "travel", by: "carol", flair: "국내", ago: 9 * 60, score: 312, video: "v_night_sky",
    title: "강원도 산골에서 찍은 별 궤적 타임랩스",
    body: "구름 한 점 없던 날이라 3시간 찍은 걸 8초로 줄였어요. 장비는 삼각대랑 미러리스 하나가 전부예요.",
    comments: [["alice", "북극성 기준으로 도는 게 보이네요! 장소 어디인지 알 수 있을까요?", 400, 24, [["carol", "안반데기예요. 새벽엔 영하라 핫팩 필수!", 380, 19]]]],
  },
  {
    c: "music", by: "bob", flair: "추천", ago: 3 * 60, score: 145, video: "v_equalizer",
    title: "공부할 때 틀어 두는 로파이 시각화 만들어 봤어요",
    body: "소리는 없고 막대만 움직여요 ㅎㅎ 캔버스로 만들었는데 생각보다 재밌네요. 다음엔 실제 음악에 맞춰 움직이게 해 볼게요.",
    comments: [["dave", "소리 없는 이퀄라이저라니 신박하다", 150, 12]],
  },
];

/** 다른 사용자가 이미 누른 투표. 로그인하면 화살표 색으로 보인다. */
const EXTRA_VOTES: [string, string, 1 | -1][] = [
  ["alice", "코드 리뷰에서 가장 많이 받는 지적은 뭔가요?", 1],
  ["alice", "오픈월드 RPG 확장팩 엔딩 보고 왔습니다 (스포 없음)", 1],
  ["bob", "React 19 에서 바뀐 것 정리해봤습니다", 1],
  ["carol", "패드 vs 키보드, 여러분은?", -1],
];

let seeded = false;

export function ensureSeeded(): void {
  if (!seeded) resetAll();
}

export function resetAll(): void {
  clearAll();
  const now = Date.now();
  const ids: Record<string, string> = {};

  USERS.forEach(({ name, phone, email, bio, avatar, interests }, i) => {
    const id = nextUserId();
    db.users.set(id, {
      id,
      name,
      ...hashPassword(SEED_PASSWORD),
      phone,
      email,
      createdAt: now - (400 - i * 30) * DAY,
      bio,
      avatar: avatar ? MEDIA[avatar].src : null,
      prefs: { ...DEFAULT_PREFS },
      gender: null,
      interests,
    });
    ids[name] = id;
  });

  for (const c of COMMUNITIES) {
    db.communities.set(c.name, {
      name: c.name,
      title: c.title,
      description: c.description,
      rules: c.rules,
      flairs: c.flairs,
      requireFlair: !!c.requireFlair,
      access: c.restricted ? "restricted" : "public",
      mature: false,
      moderatorIds: c.mods.map((m) => ids[m]),
      icon: MEDIA[`c_${c.name}_icon` as MediaKey]?.src ?? null,
      banner: MEDIA[`c_${c.name}_banner` as MediaKey]?.src ?? null,
      color: c.color,
      topics: c.topics,
      baseMembers: c.baseMembers,
      createdAt: now - c.ageDays * DAY,
    });
    const members = membersOf(c.name);
    for (const m of c.members) members.add(ids[m]);
  }

  const postIdByTitle: Record<string, string> = {};
  for (const p of POSTS) {
    const id = nextPostId();
    const createdAt = now - p.ago * MIN;
    db.posts.set(id, {
      id,
      community: p.c,
      authorId: ids[p.by],
      title: p.title,
      body: p.body ?? "",
      url: p.url ?? null,
      images: (p.images ?? []).map(([key, alt, caption]): PostImage => ({ ...MEDIA[key], alt, caption })),
      video: p.video ? { ...VIDEOS[p.video] } : null,
      spoiler: false,
      flair: p.flair ?? null,
      createdAt,
      editedAt: null,
      // 작성자의 자동 추천 1표를 더하면 적어둔 점수가 된다.
      baseScore: p.score - 1,
      pinned: !!p.pinned,
      deleted: false,
      removed: false,
    });
    castVote(ids[p.by], id, 1);
    postIdByTitle[p.title] = id;
    addComments(p.comments ?? [], id, null, createdAt, now, ids);
  }

  for (const [who, title, dir] of EXTRA_VOTES) castVote(ids[who], postIdByTitle[title], dir);
  seedActivity(now, ids, postIdByTitle);
  seedGames(now, ids);
  seeded = true;
}

function addComments(
  list: CommentSeed[],
  postId: string,
  parentId: string | null,
  parentTime: number,
  now: number,
  ids: Record<string, string>,
): void {
  for (const [author, body, after, score, replies] of list) {
    const id = nextCommentId();
    const createdAt = Math.min(parentTime + after * MIN, now - 30_000);
    db.comments.set(id, {
      id,
      postId,
      parentId,
      authorId: ids[author],
      body,
      createdAt,
      editedAt: null,
      baseScore: score - 1,
      deleted: false,
      removed: false,
    });
    castVote(ids[author], id, 1);
    if (replies) addComments(replies, postId, id, createdAt, now, ids);
  }
}

/**
 * 화면마다 처음부터 볼 거리가 있도록 활동 기록을 만든다.
 *   알림   시드 댓글에서 만든다. 하루 지난 것은 읽음으로 둔다.
 *   쪽지   alice·bob·carol·dave 사이의 대화 몇 개
 *   저장   alice 가 저장한 글 3개
 *   신고   c/dev 에 열린 신고 3건(같은 댓글 2건 포함)·처리한 신고 1건, c/games 에 열린 신고 1건
 *   정지   c/food 에서 dave 7일 활동 정지
 */
function seedActivity(now: number, ids: Record<string, string>, postIdByTitle: Record<string, string>): void {
  const comments = [...db.comments.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const c of comments) {
    const post = db.posts.get(c.postId)!;
    const parent = c.parentId ? db.comments.get(c.parentId) : undefined;
    notify({
      userId: parent ? parent.authorId : post.authorId,
      type: parent ? "comment_reply" : "post_reply",
      actorId: c.authorId,
      community: post.community,
      postId: post.id,
      commentId: c.id,
      text: c.body,
      createdAt: c.createdAt,
      readAt: now - c.createdAt > DAY ? c.createdAt + 60 * MIN : null,
    });
  }

  const MESSAGES: [string, string, number, string][] = [
    ["bob", "alice", 3 * DAY, "안녕하세요! 개발 커뮤니티에 제 가계부 앱 소개 글 올려도 될까요?"],
    ["alice", "bob", 3 * DAY - 40 * MIN, "네, '프로젝트' 말머리 달아서 올려 주시면 돼요."],
    ["bob", "alice", 3 * DAY - 35 * MIN, "감사합니다 👍"],
    ["carol", "alice", 26 * 60 * MIN, "제주 동선 글 잘 봤어요. 셋째 날 해변 이름이 뭐예요?"],
    ["alice", "carol", 25 * 60 * MIN, "협재 근처예요! 오후 4시쯤 가면 물빛이 제일 예뻐요."],
    ["dave", "alice", 50 * MIN, "포트폴리오 질문 글에 답글 달아 주셔서 감사해요. 혹시 이력서도 한번 봐 주실 수 있나요?"],
    ["dave", "alice", 48 * MIN, "바쁘시면 괜찮아요!"],
    ["carol", "dave", 2 * DAY, "맛집 커뮤니티 규칙 2번 확인 부탁드려요. 협찬 글은 밝혀 주셔야 해요."],
  ]
  for (const [from, to, ago, body] of MESSAGES) {
    const id = nextMessageId();
    const createdAt = now - ago;
    // 두 시간 넘은 쪽지는 읽은 상태, 최근 것은 안 읽은 상태
    const readAt = ago > 2 * 60 * MIN ? createdAt + 10 * MIN : null;
    db.messages.set(id, { id, fromId: ids[from], toId: ids[to], body, createdAt, readAt });
  }

  const saved = setOf(db.saves, ids.alice);
  for (const title of ["리스본 혼자 여행 후기", "10분 만에 만드는 계란볶음밥", "Git rebase 와 merge, 팀에서 뭘 쓰세요?"]) saved.add(postIdByTitle[title]);

  const spam = [...db.comments.values()].find((c) => c.body.startsWith("이런 정리는 제 블로그에"))!;
  const REPORTS: [string, "post" | "comment", string, ReportReason, number | null, string, number][] = [
    ["dave", "comment", spam.id, "spam", null, "", 90 * MIN],
    ["carol", "comment", spam.id, "rule", 2, "홍보는 프로젝트 말머리로만 올리라고 되어 있어요.", 60 * MIN],
    ["carol", "post", postIdByTitle["사이드 프로젝트로 만든 가계부 앱 공개합니다"], "spam", null, "앱 홍보 글 같아요.", 20 * 60 * MIN],
    ["alice", "post", postIdByTitle["이번 게임 쇼 발표 정리"], "misinformation", null, "출시일이 틀렸어요. 공식 발표는 다음 주로 미뤄졌어요.", 5 * 60 * MIN],
  ];
  for (const [who, targetType, targetId, reason, ruleIndex, detail, ago] of REPORTS) {
    const id = nextReportId();
    const comment = targetType === "comment" ? db.comments.get(targetId)! : null;
    const community = db.posts.get(comment ? comment.postId : targetId)!.community;
    db.reports.set(id, {
      id, targetType, targetId, community, reporterId: ids[who], reason, ruleIndex, detail,
      createdAt: now - ago, status: "open", resolvedBy: null, resolvedAt: null,
    });
  }
  // 이미 처리한 신고 하나 (처리 완료 탭)
  const resolvedId = nextReportId();
  db.reports.set(resolvedId, {
    id: resolvedId, targetType: "post", targetId: postIdByTitle["타입스크립트 strict 켜니까 에러가 300개 나왔어요"], community: "dev",
    reporterId: ids.carol, reason: "other", ruleIndex: null, detail: "질문인데 잡담 말머리를 달았어요. 말머리 수정 부탁드려요.",
    createdAt: now - 2 * DAY, status: "approved", resolvedBy: ids.alice, resolvedAt: now - 2 * DAY + 90 * MIN,
  });

  const banAt = now - DAY;
  db.bans.set(`food|${ids.dave}`, {
    community: "food", userId: ids.dave, reason: "규칙 2 위반 — 협찬 표기 없이 가게 홍보", until: banAt + 7 * DAY, byId: ids.carol, createdAt: banAt,
  });
  notify({
    userId: ids.dave, type: "banned", actorId: null, community: "food", postId: null, commentId: null,
    text: "규칙 2 위반 — 협찬 표기 없이 가게 홍보", createdAt: banAt, readAt: null,
  });
}
