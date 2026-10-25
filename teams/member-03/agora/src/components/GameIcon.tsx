import { ArrowUpDown, Brain, Gamepad2, Lightbulb, SpellCheck } from "lucide-react";
import { clsx } from "clsx";

const ICONS: Record<string, typeof Gamepad2> = {
  word5: SpellCheck,
  memory: Brain,
  lights: Lightbulb,
  updown: ArrowUpDown,
};

const SIZES = {
  sm: ["h-7 w-7", "h-4 w-4"],
  md: ["h-10 w-10", "h-5 w-5"],
  lg: ["h-14 w-14", "h-7 w-7"],
} as const;

/** 게임 아이콘. 게임 색 동그라미 안에 그림을 그린다. 이름 옆에 붙어 나오므로 낭독기에서는 건너뛴다. */
export function GameIcon({ id, color, size = "sm" }: { id: string; color: string; size?: keyof typeof SIZES }) {
  const Icon = ICONS[id] ?? Gamepad2;
  const [box, glyph] = SIZES[size];
  return (
    <span aria-hidden="true" className={clsx("inline-flex shrink-0 items-center justify-center rounded-full text-gray-900", box)} style={{ backgroundColor: color }}>
      <Icon className={glyph} strokeWidth={2.25} />
    </span>
  );
}
