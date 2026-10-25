/**
 * 글쓰기 도구 모음의 서식 넣기. 고른 글자(없으면 커서 자리)에 마크다운 기호를 붙인다.
 * 결과는 새 본문과, 이어서 고쳐 쓰기 좋게 잡아 둘 선택 범위다. (src/lib/markdown.tsx 가 같은 문법을 그린다)
 */

export type Format =
  | "bold" | "italic" | "strike" | "superscript" | "heading" | "link"
  | "bullet" | "number" | "spoiler" | "quote" | "code" | "codeblock" | "table";

export interface Edit {
  value: string;
  start: number;
  end: number;
}

const WRAP: Partial<Record<Format, [string, string, string]>> = {
  // [앞, 뒤, 고른 글자가 없을 때 넣을 자리 글자]
  bold: ["**", "**", "굵은 글씨"],
  italic: ["*", "*", "기울인 글씨"],
  strike: ["~~", "~~", "취소선"],
  superscript: ["^(", ")", "위 첨자"],
  spoiler: [">!", "!<", "스포일러"],
  code: ["`", "`", "코드"],
};

const LINE_PREFIX: Partial<Record<Format, (i: number) => string>> = {
  heading: () => "## ",
  bullet: () => "- ",
  number: (i) => `${i + 1}. `,
  quote: () => "> ",
};

export function applyFormat(value: string, start: number, end: number, format: Format, placeholder: (text: string) => string = (s) => s): Edit {
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  const wrap = WRAP[format];
  if (wrap) {
    const [open, close, hint] = wrap;
    const inner = selected || placeholder(hint);
    return { value: before + open + inner + close + after, start: start + open.length, end: start + open.length + inner.length };
  }

  const prefix = LINE_PREFIX[format];
  if (prefix) {
    // 고른 줄 전체(커서만 있으면 그 줄)에 줄머리를 붙인다.
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const nextBreak = value.indexOf("\n", end);
    const lineEnd = nextBreak < 0 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd).split("\n");
    const replaced = lines.map((line, i) => prefix(i) + line).join("\n");
    const out = value.slice(0, lineStart) + replaced + value.slice(lineEnd);
    return { value: out, start: lineStart, end: lineStart + replaced.length };
  }

  if (format === "link") {
    const label = selected || placeholder("링크 글자");
    const text = `[${label}](https://)`;
    const urlStart = start + label.length + 3;
    return { value: before + text + after, start: urlStart, end: urlStart + "https://".length };
  }

  // 블록(코드 블록 · 표)은 앞뒤를 빈 줄로 띄워 다른 문단과 섞이지 않게 한다.
  const pad = (s: string) => (before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "") + s + (after.startsWith("\n") ? "" : "\n");
  if (format === "codeblock") {
    const code = selected || placeholder("코드");
    const block = pad("```\n" + code + "\n```");
    const codeStart = before.length + block.indexOf("```\n") + 4;
    return { value: before + block + after, start: codeStart, end: codeStart + code.length };
  }
  // table
  const h1 = placeholder("머리 1");
  const h2 = placeholder("머리 2");
  const c = placeholder("내용@@cell");
  const block = pad(`| ${h1} | ${h2} |\n| --- | --- |\n| ${c} | ${c} |`);
  const first = before.length + block.indexOf(h1);
  return { value: before + block + after, start: first, end: first + h1.length };
}
