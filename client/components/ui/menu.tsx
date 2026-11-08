"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface MenuCtx {
  close: () => void;
}
const Ctx = createContext<MenuCtx>({ close: () => {} });

/**
 * Dropdown menu: click or Enter/Space to open, arrow keys to move, Esc or click outside to close.
 * `trigger` receives the props to spread onto your button.
 */
export function Menu({
  trigger,
  children,
  align = "end",
  className,
}: {
  trigger: (props: React.ButtonHTMLAttributes<HTMLButtonElement> & { ref: React.Ref<HTMLButtonElement> }) => React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    // focus the first item once it renders
    const t = window.setTimeout(() => listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(), 0);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.clearTimeout(t);
    };
  }, [open]);

  const onListKey = (e: React.KeyboardEvent) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items.at(-1)?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <Ctx.Provider value={{ close }}>
      <div ref={rootRef} className="relative">
        {trigger({
          ref: triggerRef,
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "aria-controls": open ? id : undefined,
          onClick: () => setOpen((o) => !o),
          onKeyDown: (e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
          },
        })}
        <AnimatePresence>
          {open && (
            <motion.div
              ref={listRef}
              id={id}
              role="menu"
              onKeyDown={onListKey}
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              className={cn(
                "absolute top-[calc(100%+8px)] z-40 min-w-[220px] origin-top-right rounded-xl border border-line bg-card p-1.5 shadow-[0_16px_40px_-16px_rgb(22_22_20/0.35)]",
                align === "end" ? "right-0" : "left-0",
                className,
              )}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

const itemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] text-ink outline-none transition-colors hover:bg-ink/5 focus-visible:bg-ink/5";

export function MenuLink({ href, icon, children }: { href: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const { close } = useContext(Ctx);
  return (
    <Link href={href} role="menuitem" tabIndex={-1} onClick={close} className={itemClass}>
      {icon && <span className="text-muted">{icon}</span>}
      {children}
    </Link>
  );
}

export function MenuButton({
  onSelect,
  icon,
  children,
  danger,
}: {
  onSelect: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  danger?: boolean;
}) {
  const { close } = useContext(Ctx);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={() => {
        close();
        onSelect();
      }}
      className={cn(itemClass, danger && "text-red-600")}
    >
      {icon && <span className={danger ? "text-red-500" : "text-muted"}>{icon}</span>}
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1.5 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pb-2 pt-1.5">{children}</div>;
}
