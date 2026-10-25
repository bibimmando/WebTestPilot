import type { Bug } from "./types";
import { functionalBugs } from "./functional";
import { validationBugs } from "./validation";
import { routingBugs } from "./routing";
import { uiBugs } from "./ui";

export type { Bug } from "./types";

/**
 * 결함 토글. Maison 과 같은 방식이다.
 *
 *   npm run dev                   정상 사이트 (기본값)
 *   BUGS_ON=all npm run dev       전부 켬
 *   BUG_F1=1 BUG_U2=1 npm run dev 지정한 것만
 *
 * 같은 코드에서 환경변수만 달리해 띄우므로 "두 버전의 차이는 주입한 결함뿐" 이 보장된다.
 */
export const allBugs: Bug[] = [...functionalBugs, ...validationBugs, ...routingBugs, ...uiBugs];

{
  const seen = new Set<string>();
  for (const bug of allBugs) {
    if (seen.has(bug.id)) throw new Error(`결함 ID 가 겹칩니다: ${bug.id}`);
    seen.add(bug.id);
  }
}

const enabled = new Set(
  process.env.BUGS_ON === "all"
    ? allBugs.map((b) => b.id)
    : allBugs.filter((b) => process.env[`BUG_${b.id}`] === "1").map((b) => b.id),
);

export function enabledIds(): string[] {
  return [...enabled];
}

/** 서버 코드에서 쓴다. 화면 쪽은 src/lib/bugs.ts 의 useBug() 를 쓴다. */
export function isOn(id: string): boolean {
  return enabled.has(id);
}

function countBy<K extends keyof Bug>(list: Bug[], key: K): Record<string, number> {
  const out: Record<string, number> = {};
  for (const bug of list) out[String(bug[key])] = (out[String(bug[key])] ?? 0) + 1;
  return out;
}

/** 정답지. GET /gt.json 이 그대로 내보낸다. 레지스트리에서 만들므로 코드와 어긋나지 않는다. */
export function groundTruth() {
  const on = allBugs.filter((b) => enabled.has(b.id));
  return {
    site: "agora",
    generatedAt: new Date().toISOString(),
    total: allBugs.length,
    enabled: on.length,
    byArea: countBy(on, "area"),
    bySymptom: countBy(on, "symptom"),
    detectable: on.filter((b) => b.detectable).length,
    defects: on,
  };
}
