import type { Bug, BugArea, BugSymptom } from "./types";
import { functionalBugs } from "./functional";
import { validationBugs } from "./validation";
import { routingBugs } from "./routing";
import { uiBugs } from "./ui";

export type { Bug, BugArea, BugSymptom } from "./types";

/**
 * 버그 토글.
 *
 * 정상 사이트와 버그 사이트를 따로 만들지 않는다. 같은 코드에서 환경변수만
 * 달리해 두 가지로 띄운다. 코드가 같으므로 "두 버전의 차이는 주입한 결함뿐"
 * 이라는 벤치마크의 전제가 보장된다.
 *
 *   npm run dev                  정상 사이트 (기본값)
 *   BUGS_ON=all npm run dev      전부 켬
 *   BUG_F1=1 BUG_U2=1 npm run dev 지정한 것만
 *
 * 기본값을 "꺼짐"으로 둔 이유: 환경변수를 깜빡해도 멀쩡한 사이트가 뜬다.
 * 반대로 하면 처음 받은 사람이 깨진 화면을 보고 자기 실수인지 헷갈린다.
 */

export const allBugs: Bug[] = [
  ...functionalBugs,
  ...validationBugs,
  ...routingBugs,
  ...uiBugs,
];

// ID 가 겹치면 정답지가 망가진다. 담당자끼리 접두사를 나눠 쓰지만
// 같은 분야 안에서 번호를 두 번 쓰는 실수는 막아야 한다.
{
  const seen = new Set<string>();
  for (const bug of allBugs) {
    if (seen.has(bug.id)) {
      throw new Error(
        `버그 ID 가 겹칩니다: ${bug.id}. server/bugs/*.ts 를 확인하세요.`,
      );
    }
    seen.add(bug.id);
  }
}

function computeEnabled(): string[] {
  if (process.env.BUGS_ON === "all") return allBugs.map((b) => b.id);

  const picked = allBugs.filter((b) => process.env[`BUG_${b.id}`] === "1");
  return picked.map((b) => b.id);
}

const enabled = new Set(computeEnabled());

/** 지금 켜진 버그 ID. 서버가 시작할 때 한 번 정해지고 바뀌지 않는다. */
export function enabledIds(): string[] {
  return [...enabled];
}

/** 서버 코드가 쓴다. 화면 쪽은 src/hooks/useBugs.ts 의 useBug() 를 쓴다. */
export function isOn(id: string): boolean {
  return enabled.has(id);
}

function countBy<K extends keyof Bug>(list: Bug[], key: K) {
  const out: Record<string, number> = {};
  for (const bug of list) {
    const value = String(bug[key]);
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

/**
 * 정답지. GET /gt.json 이 그대로 내보낸다.
 *
 * 레지스트리에서 생성하므로 손으로 쓴 목록과 코드가 어긋날 수 없다.
 * 담당자가 자기 파일에 한 건을 추가하면 여기에 자동으로 나타난다.
 */
export function groundTruth() {
  const on = allBugs.filter((b) => enabled.has(b.id));
  return {
    generatedAt: new Date().toISOString(),
    total: allBugs.length,
    enabled: on.length,
    byArea: countBy(on, "area"),
    bySymptom: countBy(on, "symptom"),
    // 규칙만으로 잡힐 것이라 선언된 건수. 실제 결과와 대조하는 기준이 된다.
    detectable: on.filter((b) => b.detectable).length,
    defects: on,
  };
}
