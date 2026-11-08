"use client";

import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepItem<T extends string> {
  value: T;
  label: string;
  done?: boolean;
  /** can't be opened yet (e.g. needs the draft to exist first) */
  locked?: boolean;
}

/**
 * Numbered steps for wizards. Steps are buttons so people can jump back and forth;
 * the list scrolls sideways on phones.
 */
export function Stepper<T extends string>({
  steps,
  current,
  onSelect,
  className,
}: {
  steps: StepItem<T>[];
  current: T;
  onSelect: (value: T) => void;
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "flex gap-1 overflow-x-auto rounded-2xl border border-line bg-card p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {steps.map((s, i) => {
        const active = s.value === current;
        return (
          <li key={s.value} className="min-w-fit flex-1">
            <button
              type="button"
              onClick={() => onSelect(s.value)}
              disabled={s.locked}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                active ? "bg-ink text-paper" : "text-ink/70 hover:bg-ink/[0.05] hover:text-ink",
                s.locked && "cursor-not-allowed text-ink/30 hover:bg-transparent hover:text-ink/30",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border font-mono text-[11px]",
                  active
                    ? "border-paper/30 text-paper"
                    : s.done
                      ? "border-ink bg-ink text-paper"
                      : "border-line text-ink/50",
                  active && s.done && "border-accent bg-accent text-ink",
                )}
              >
                {s.locked ? <Lock className="size-3" /> : s.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="whitespace-nowrap">{s.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
