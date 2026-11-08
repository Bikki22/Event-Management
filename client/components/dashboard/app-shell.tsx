"use client";

import { ArrowUpRight, LogOut, Menu as MenuIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { RequireAuth, RequireRole } from "@/components/auth/guards";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";
import { useAuth, useLogout } from "@/hooks/use-auth";
import type { Role } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export interface ShellNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** shown greyed out with a "Soon" tag until its phase is built */
  soon?: boolean;
  /** match only this exact path (for the overview item) */
  exact?: boolean;
}

/**
 * Full-page app layout for the organizer dashboard and the admin panel: their own sidebar,
 * no site navbar/footer. Signed-in users with the right role only.
 */
export function AppShell({
  area,
  roles,
  nav,
  children,
}: {
  area: string;
  roles: Role[];
  nav: ShellNavItem[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-1">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-line bg-card lg:flex">
        <SidebarContent area={area} nav={nav} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* phone / tablet top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-paper/90 px-4 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-2.5">
            <Logo />
            <AreaTag area={area} />
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="grid size-10 place-items-center rounded-lg transition hover:bg-ink/5"
          >
            <MenuIcon className="size-5" />
          </button>
        </header>

        <main id="main" className="flex-1 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
          <div className="mx-auto w-full max-w-5xl">
            <RequireAuth>
              <RequireRole roles={roles}>{children}</RequireRole>
            </RequireAuth>
          </div>
        </main>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={area} side="left">
        <SidebarContent area={area} nav={nav} onNavigate={() => setOpen(false)} hideLogo />
      </Sheet>
    </div>
  );
}

function AreaTag({ area }: { area: string }) {
  return (
    <span className="rounded-md bg-ink px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-paper">
      {area}
    </span>
  );
}

function SidebarContent({
  area,
  nav,
  onNavigate,
  hideLogo,
}: {
  area: string;
  nav: ShellNavItem[];
  onNavigate?: () => void;
  hideLogo?: boolean;
}) {
  const pathname = usePathname();
  const { user } = useAuth();
  const logout = useLogout();

  return (
    <div className="flex h-full flex-col">
      {!hideLogo && (
        <div className="flex h-16 items-center gap-2.5 px-5">
          <Logo />
          <AreaTag area={area} />
        </div>
      )}

      <nav aria-label={area} className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {nav.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          if (item.soon) {
            return (
              <span
                key={item.href}
                aria-disabled
                className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] text-ink/35"
              >
                <Icon className="size-[18px]" />
                <span className="flex-1">{item.label}</span>
                <span className="rounded bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink/45">Soon</span>
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] transition-colors",
                active ? "bg-ink text-paper" : "text-ink/70 hover:bg-ink/[0.05] hover:text-ink",
              )}
            >
              <Icon className={cn("size-[18px]", active ? "text-accent" : "text-muted")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-line p-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] text-ink/70 transition hover:bg-ink/[0.05] hover:text-ink"
        >
          <ArrowUpRight className="size-[18px] text-muted" /> Back to Book Event
        </Link>
        {user && (
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <Avatar name={user.fullName} className="size-8 text-[12px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium">{user.fullName}</p>
              <p className="truncate text-[12px] text-muted">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              aria-label="Sign out"
              title="Sign out"
              className="grid size-8 place-items-center rounded-md text-muted transition hover:bg-red-50 hover:text-red-600"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Page title block inside the dashboards. */
export function DashHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted">{eyebrow}</p>}
        <h1 className="mt-1 text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[34px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
