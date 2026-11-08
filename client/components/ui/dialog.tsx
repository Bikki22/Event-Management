"use client";

import { X } from "lucide-react";
import { Button } from "./button";
import { Overlay } from "./overlay";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <Overlay
      open={open}
      onClose={onClose}
      label={title}
      panel={{
        initial: { opacity: 0, y: 12, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 8, scale: 0.98 },
        transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
        className: cn(
          "absolute inset-x-4 bottom-4 mx-auto max-w-md rounded-2xl bg-card p-6 shadow-[0_24px_60px_-20px_rgb(22_22_20/0.45)] focus:outline-none sm:inset-x-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2",
          className,
        ),
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 -mt-1 grid size-8 place-items-center rounded-md text-muted transition hover:bg-ink/5 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
      {description && <div className="mt-2 text-[14.5px] leading-relaxed text-muted">{description}</div>}
      {children && <div className="mt-5">{children}</div>}
      {footer && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
    </Overlay>
  );
}

/** Yes/no confirmation; `destructive` paints the confirm button red. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            loading={loading}
            data-autofocus
            className={destructive ? "bg-red-600 hover:bg-red-700" : undefined}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
