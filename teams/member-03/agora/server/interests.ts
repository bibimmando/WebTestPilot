import { currentLang } from "./i18n";

/**
 * 가입할 때 고르는 관심 항목. id 는 저장용, label · emoji 는 화면용.
 * 순서가 곧 화면에 보이는 순서다.
 */
export const INTEREST_CATEGORIES = [
  {
    id: "games",
    label: "게임",
    items: [
      { id: "pc_games", label: "PC 게임", emoji: "🖥️" },
      { id: "console_games", label: "콘솔 게임", emoji: "🕹️" },
      { id: "mobile_games", label: "모바일 게임", emoji: "📱" },
      { id: "esports", label: "e스포츠", emoji: "🏆" },
      { id: "indie_games", label: "인디 게임", emoji: "👾" },
      { id: "board_games", label: "보드게임", emoji: "🎲" },
    ],
  },
  {
    id: "money",
    label: "투자·경제",
    items: [
      { id: "stocks", label: "주식", emoji: "📈" },
      { id: "crypto", label: "코인", emoji: "🪙" },
      { id: "real_estate", label: "부동산", emoji: "🏠" },
      { id: "personal_finance", label: "재테크", emoji: "💰" },
      { id: "economy", label: "경제 뉴스", emoji: "📰" },
    ],
  },
  {
    id: "tech",
    label: "기술",
    items: [
      { id: "programming", label: "프로그래밍", emoji: "💻" },
      { id: "ai", label: "인공지능", emoji: "🤖" },
      { id: "gadgets", label: "전자기기", emoji: "⌚" },
      { id: "smartphones", label: "스마트폰", emoji: "📲" },
      { id: "pc_hardware", label: "PC 하드웨어", emoji: "🔧" },
    ],
  },
  {
    id: "food",
    label: "음식",
    items: [
      { id: "restaurants", label: "맛집", emoji: "🍜" },
      { id: "cooking", label: "요리", emoji: "🍳" },
      { id: "baking", label: "베이킹", emoji: "🧁" },
      { id: "coffee", label: "카페·커피", emoji: "☕" },
      { id: "drinks", label: "술", emoji: "🍺" },
    ],
  },
  {
    id: "travel",
    label: "여행·야외",
    items: [
      { id: "domestic_travel", label: "국내 여행", emoji: "🗺️" },
      { id: "overseas_travel", label: "해외 여행", emoji: "✈️" },
      { id: "camping", label: "캠핑", emoji: "⛺" },
      { id: "hiking", label: "등산", emoji: "🥾" },
    ],
  },
  {
    id: "entertainment",
    label: "엔터테인먼트",
    items: [
      { id: "movies", label: "영화", emoji: "🎬" },
      { id: "dramas", label: "드라마", emoji: "📺" },
      { id: "variety", label: "예능", emoji: "😂" },
      { id: "anime", label: "애니메이션", emoji: "🌸" },
      { id: "webtoon", label: "웹툰", emoji: "📖" },
    ],
  },
  {
    id: "music",
    label: "음악",
    items: [
      { id: "kpop", label: "K-POP", emoji: "🎤" },
      { id: "hiphop", label: "힙합", emoji: "🎧" },
      { id: "indie_music", label: "인디 음악", emoji: "🎸" },
      { id: "classical", label: "클래식", emoji: "🎻" },
    ],
  },
  {
    id: "sports",
    label: "스포츠·운동",
    items: [
      { id: "soccer", label: "축구", emoji: "⚽" },
      { id: "baseball", label: "야구", emoji: "⚾" },
      { id: "basketball", label: "농구", emoji: "🏀" },
      { id: "fitness", label: "헬스", emoji: "🏋️" },
      { id: "running", label: "러닝", emoji: "🏃" },
    ],
  },
  {
    id: "lifestyle",
    label: "라이프스타일",
    items: [
      { id: "fashion", label: "패션", emoji: "👗" },
      { id: "beauty", label: "뷰티", emoji: "💄" },
      { id: "interior", label: "인테리어", emoji: "🛋️" },
      { id: "pets", label: "반려동물", emoji: "🐶" },
      { id: "parenting", label: "육아", emoji: "🍼" },
    ],
  },
  {
    id: "career",
    label: "학습·커리어",
    items: [
      { id: "jobs", label: "취업·이직", emoji: "💼" },
      { id: "certificates", label: "자격증", emoji: "📝" },
      { id: "languages", label: "외국어", emoji: "🗣️" },
      { id: "campus", label: "대학 생활", emoji: "🎓" },
    ],
  },
  {
    id: "hobbies",
    label: "취미",
    items: [
      { id: "photography", label: "사진", emoji: "📷" },
      { id: "drawing", label: "그림", emoji: "🎨" },
      { id: "reading", label: "독서", emoji: "📚" },
      { id: "models", label: "레고·프라모델", emoji: "🧱" },
    ],
  },
  {
    id: "humor",
    label: "유머",
    items: [
      { id: "memes", label: "밈", emoji: "🐸" },
      { id: "funny", label: "웃긴 이야기", emoji: "🤣" },
    ],
  },
] as const;

export const INTEREST_IDS: ReadonlySet<string> = new Set(INTEREST_CATEGORIES.flatMap((c) => c.items.map((i) => i.id)));

export const GENDERS = ["male", "female", "nonbinary"] as const;
export type Gender = (typeof GENDERS)[number];

/** 관심 항목 · 분류의 영어 이름 (id → 이름) */
const EN_LABELS: Record<string, string> = {
  games: "Gaming", pc_games: "PC games", console_games: "Console games", mobile_games: "Mobile games", esports: "Esports",
  indie_games: "Indie games", board_games: "Board games",
  money: "Money & investing", stocks: "Stocks", crypto: "Crypto", real_estate: "Real estate", personal_finance: "Personal finance",
  economy: "Economic news",
  tech: "Tech", programming: "Programming", ai: "AI", gadgets: "Gadgets", smartphones: "Smartphones", pc_hardware: "PC hardware",
  food: "Food", restaurants: "Restaurants", cooking: "Cooking", baking: "Baking", coffee: "Cafés & coffee", drinks: "Drinks",
  travel: "Travel & outdoors", domestic_travel: "Domestic travel", overseas_travel: "Travel abroad", camping: "Camping", hiking: "Hiking",
  entertainment: "Entertainment", movies: "Movies", dramas: "TV dramas", variety: "Variety shows", anime: "Anime", webtoon: "Webtoons",
  music: "Music", kpop: "K-pop", hiphop: "Hip-hop", indie_music: "Indie music", classical: "Classical",
  sports: "Sports & fitness", soccer: "Soccer", baseball: "Baseball", basketball: "Basketball", fitness: "Gym", running: "Running",
  lifestyle: "Lifestyle", fashion: "Fashion", beauty: "Beauty", interior: "Interior design", pets: "Pets", parenting: "Parenting",
  career: "Learning & careers", jobs: "Jobs & careers", certificates: "Certifications", languages: "Languages", campus: "College life",
  hobbies: "Hobbies", photography: "Photography", drawing: "Drawing", reading: "Reading", models: "LEGO & models",
  humor: "Humor", memes: "Memes", funny: "Funny stories",
};

const KO_LABELS = new Map<string, string>(
  INTEREST_CATEGORIES.flatMap((c) => [[c.id, c.label] as const, ...c.items.map((i) => [i.id, i.label] as const)]),
);

/** 지금 요청 언어로 된 이름 */
export function interestLabel(id: string): string {
  return (currentLang() === "en" && EN_LABELS[id]) || KO_LABELS.get(id) || id;
}

export function localizedCategories() {
  return INTEREST_CATEGORIES.map((c) => ({
    id: c.id,
    label: interestLabel(c.id),
    items: c.items.map((i) => ({ id: i.id, label: interestLabel(i.id), emoji: i.emoji })),
  }));
}
