"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef } from "react";
import { cn } from "@/lib/utils";

/** Tabs that change local state (e.g. Upcoming / Past). Arrow keys move between tabs. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: React.ReactNode; count?: number }[];
  className?: string;
}) {
  const layoutId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const onKey = (e: React.KeyboardEvent) => {
    const i = items.findIndex((t) => t.value === value);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const item = items[(next + items.length) % items.length];
    onChange(item.value);
    listRef.current?.querySelector<HTMLElement>(`[data-value="${item.value}"]`)?.focus();
  };

  return (
    <div ref={listRef} role="tablist" onKeyDown={onKey} className={cn("flex gap-1 border-b border-line", className)}>
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            data-value={t.value}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cn(
              "relative -mb-px px-3 pb-3 pt-1 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:text-ink",
              active ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 text-[12px] text-muted">{t.count}</span>}
            {active && <motion.span layoutId={layoutId} className="absolute inset-x-0 -bottom-px h-0.5 bg-ink" />}
          </button>
        );
      })}
    </div>
  );
}

/** Navigation tabs driven by the URL (e.g. account sections). */
export function NavTabs({ items, className }: { items: { href: string; label: string }[]; className?: string }) {
  const pathname = usePathname();
  const layoutId = useId();
  return (
    // scrolls sideways on small screens; the bottom rule is an inset shadow so the
    // active underline (drawn inside each tab) isn't clipped by the overflow
    <nav
      className={cn(
        "flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {items.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative shrink-0 px-3 pb-3 pt-1 text-[14px] font-medium transition-colors",
              active ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            {t.label}
            {active && <motion.span layoutId={layoutId} className="absolute inset-x-0 bottom-0 h-0.5 bg-ink" />}
          </Link>
        );
      })}
    </nav>
  );
}
