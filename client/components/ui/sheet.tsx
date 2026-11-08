"use client";

import { X } from "lucide-react";
import { Overlay } from "./overlay";
import { cn } from "@/lib/utils";

/** Slide-in panel from the side (mobile navigation, filters). */
export function Sheet({
  open,
  onClose,
  title,
  side = "right",
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "left" | "right";
  children: React.ReactNode;
  className?: string;
}) {
  const offset = side === "right" ? "100%" : "-100%";
  return (
    <Overlay
      open={open}
      onClose={onClose}
      label={title}
      panel={{
        initial: { x: offset },
        animate: { x: 0 },
        exit: { x: offset },
        transition: { type: "spring", stiffness: 380, damping: 38 },
        className: cn(
          "absolute inset-y-0 flex w-[min(86vw,360px)] flex-col bg-paper shadow-2xl focus:outline-none",
          side === "right" ? "right-0" : "left-0",
          className,
        ),
      }}
    >
      <div className="flex h-16 items-center justify-between border-b border-line px-5">
        <span className="text-[15px] font-semibold">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-9 place-items-center rounded-md text-muted transition hover:bg-ink/5 hover:text-ink"
        >
          <X className="size-[18px]" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </Overlay>
  );
}
