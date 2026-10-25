import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { useT } from "@/i18n";

/**
 * 글 본문용 작은 마크다운. 글쓰기 도구 모음이 넣는 문법만 다룬다.
 *   블록: # 제목(1~3단계), > 인용, - · * 목록, 1. 번호 목록, ``` 코드 블록, | 표 |, 빈 줄로 문단
 *   글자: **굵게** *기울임* ~~취소선~~ ^위첨자 ^(여러 단어) `코드` [링크](https://…) >!스포일러!< 그리고 맨 주소
 * HTML 을 문자열로 만들지 않고 React 요소로 그린다 — 글쓴이가 넣은 태그나 스크립트는 그냥 글자로 보인다.
 * 링크는 http · https 만 걸고, 나머지(javascript: 등)는 글자로 둔다.
 */

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++; // 닫는 ```
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ kind: "h", level: h[1].length as 1 | 2 | 3, text: h[2] });
      i++;
      continue;
    }
    // 표: 머리 줄 다음에 |---|---| 구분 줄
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    // 인용 (">!" 로 시작하면 스포일러라 인용이 아니다)
    if (/^>(?!!)/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>(?!!)/.test(lines[i])) quoted.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", lines: quoted });
      continue;
    }
    if (BULLET.test(line) || NUMBER.test(line)) {
      const ordered = !BULLET.test(line);
      const re = ordered ? NUMBER : BULLET;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(re.exec(lines[i++])![1]);
      blocks.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !HEADING.test(lines[i]) && !lines[i].trim().startsWith("```") && !/^>(?!!)/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBER.test(lines[i])) {
      para.push(lines[i++]);
    }
    blocks.push({ kind: "p", lines: para });
  }
  return blocks;
}

// 앞에서부터 가장 먼저 나오는 글자 문법을 찾는다.
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(~~[^~\n]+?~~)|(>![^\n]+?!<)|(\[[^\]\n]+\]\([^)\s]+\))|(\^\([^)\n]+\)|\^[^\s^]+)|((?<![\w*])\*[^*\s][^*\n]*?\*(?!\w))|(https?:\/\/[^\s<>()]+[^\s<>().,!?])/;

const SAFE_URL = /^https?:\/\//i;

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="rounded bg-bg px-1 py-0.5 font-mono text-[0.9em] ring-1 ring-line">{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<del key={k}>{inline(tok.slice(2, -2), k)}</del>);
    else if (m[4]) out.push(<Spoiler key={k}>{inline(tok.slice(2, -2), k)}</Spoiler>);
    else if (m[5]) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      out.push(
        SAFE_URL.test(href) ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2 hover:text-accent-strong">
            {inline(label, k)}
          </a>
        ) : (
          tok
        ),
      );
    } else if (m[6]) out.push(<sup key={k}>{tok.startsWith("^(") ? inline(tok.slice(2, -1), k) : tok.slice(1)}</sup>);
    else if (m[7]) out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    else if (m[8])
      out.push(
        <a key={k} href={tok} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent underline underline-offset-2 hover:text-accent-strong">
          {tok}
        </a>,
      );
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

/** >!스포일러!< — 누르기 전에는 가려 둔다. */
function Spoiler({ children }: { children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (open) return <span className="rounded bg-bg px-0.5 ring-1 ring-line">{children}</span>;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="rounded bg-ink px-1 text-transparent transition-colors hover:bg-ink/80"
      aria-label={t("스포일러 보기")}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

const withBreaks = (lines: string[], key: string) =>
  lines.flatMap((line, i) => (i === 0 ? inline(line, `${key}-${i}`) : [<br key={`${key}-br${i}`} />, ...inline(line, `${key}-${i}`)]));

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={clsx("space-y-3 break-words", className)}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case "h": {
            // 글 제목이 h1 이라 본문 제목은 h2 부터
            const Tag = (["h2", "h3", "h4"] as const)[b.level - 1];
            return <Tag key={k} className={clsx("font-bold", b.level === 1 ? "text-xl" : b.level === 2 ? "text-lg" : "text-base")}>{inline(b.text, k)}</Tag>;
          }
          case "quote":
            return <blockquote key={k} className="border-l-4 border-line pl-3 text-muted">{withBreaks(b.lines, k)}</blockquote>;
          case "ul":
            return <ul key={k} className="list-disc space-y-1 pl-6">{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ul>;
          case "ol":
            return <ol key={k} className="list-decimal space-y-1 pl-6">{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ol>;
          case "code":
            return <pre key={k} className="overflow-x-auto rounded-lg bg-bg p-3 font-mono text-sm ring-1 ring-line"><code>{b.text}</code></pre>;
          case "table":
            return (
              <div key={k} className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr>{b.head.map((c, j) => <th key={j} className="border border-line bg-bg px-3 py-1.5 text-left font-semibold">{inline(c, `${k}-h${j}`)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>{b.head.map((_, j) => <td key={j} className="border border-line px-3 py-1.5">{inline(row[j] ?? "", `${k}-${r}-${j}`)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={k}>{withBreaks(b.lines, k)}</p>;
        }
      })}
    </div>
  );
}

/** 목록 미리보기용 글자만. 문법 기호를 지우고, 스포일러는 내용 대신 [스포일러] 로 바꾼다. */
export function plainText(text: string, spoilerLabel: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/>![\s\S]+?!</g, `[${spoilerLabel}]`)
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|~~|`/g, "")
    .replace(/(?<![\w*])\*([^*\s][^*\n]*?)\*(?!\w)/g, "$1")
    .replace(/\^\(([^)]+)\)/g, "$1")
    .replace(/\|/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}
