/** 한 판이 끝났을 때. score 는 적을수록 좋은 횟수, 진 판이면 won: false (answer 는 정답을 보여 줄 때) */
export interface GameResult {
  score: number;
  won: boolean;
  answer?: string;
}

export interface BoardProps {
  /** 0 이면 첫 판, 다시 하기를 누를 때마다 1씩 늘어 새 판을 만든다 */
  round: number;
  /** 정해져 있으면 판을 이 시드로 만든다 (같은 시드 · 같은 판 번호 → 같은 판). null 이면 무작위 */
  seed: number | null;
  onFinish: (result: GameResult) => void;
}
