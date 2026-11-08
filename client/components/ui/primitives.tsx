import { LoaderCircle } from "lucide-react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

// ───────────── Card ─────────────

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-line bg-card", className)} {...props} />;
}

/** Card with a title row and an optional action; used for settings sections. */
export function Section({
  title,
  description,
  action,
  children,
  footer,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-4 p-6 pb-0">
        <div>
          <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
          {description && <p className="mt-1 text-[14px] leading-relaxed text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children && <div className="p-6">{children}</div>}
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line bg-paper/60 px-6 py-3.5">
          {footer}
        </div>
      )}
    </Card>
  );
}

// ───────────── Badge ─────────────

const badgeTones = {
  neutral: "bg-ink/[0.06] text-ink/75",
  dark: "bg-ink text-paper",
  accent: "bg-accent/12 text-[#c2410c]",
  success: "bg-green-600/10 text-green-800",
  warning: "bg-amber-500/15 text-amber-800",
  danger: "bg-red-500/10 text-red-700",
} as const;

export function Badge({
  tone = "neutral",
  dot,
  className,
  children,
}: {
  tone?: keyof typeof badgeTones;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium",
        badgeTones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// ───────────── Skeleton / Spinner ─────────────

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-ink/[0.07]", className)} />;
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <LoaderCircle role="status" aria-label={label} className={cn("size-5 animate-spin text-muted", className)} />;
}

/** Full-area loading state for pages. */
export function PageLoader() {
  return (
    <div className="grid flex-1 place-items-center py-24">
      <Spinner />
    </div>
  );
}

// ───────────── Empty state ─────────────

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-14 text-center", className)}>
      {icon && <div className="mb-4 grid size-11 place-items-center rounded-full bg-ink/[0.05] text-ink/70">{icon}</div>}
      <p className="text-[16px] font-semibold tracking-[-0.015em]">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

// ───────────── Avatar ─────────────

export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-ink text-[13px] font-semibold text-paper",
        className,
      )}
      aria-hidden
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- small avatar from our storage
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
