"use client";

import { ArrowLeft, KeyRound, LogOut, MonitorSmartphone, Receipt, Ticket, UserRound, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { RequireAuth, VerifyEmailBanner } from "@/components/auth/guards";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/primitives";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useReturnTo } from "@/stores/return-to-store";

interface Item {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const items: Item[] = [
  { href: "/account", label: "Profile", description: "Your name, email and phone number.", icon: UserRound },
  { href: "/account/security", label: "Password", description: "Change the password you sign in with.", icon: KeyRound },
  { href: "/account/devices", label: "Devices", description: "Where you're signed in right now.", icon: MonitorSmartphone },
  { href: "/account/tickets", label: "Tickets", description: "Tickets for upcoming and past events.", icon: Ticket },
  { href: "/account/bookings", label: "Bookings", description: "Orders, payments and refunds.", icon: Receipt },
];

/**
 * Self-contained account page: no site navbar or search. The logo returns to the page
 * the user came from. Section links use `replace`, so switching sections doesn't pile up
 * history and the browser back button also leaves the account area in one step.
 */
export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // detail pages (/account/tickets/{id}) belong to their parent section and render their own heading
  const nested = !items.some((i) => i.href === pathname);
  const current = items.find((i) => isActive(i.href, pathname)) ?? items[0];

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
        <VerifyEmailBanner />
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Logo />
          <span className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted">Account</span>
        </div>
      </header>

      <RequireAuth>
        <div className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-5 py-8 sm:px-8 sm:py-12 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14">
          <Sidebar pathname={pathname} />

          <main id="main" className="min-w-0">
            <MobileTabs pathname={pathname} />
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              {!nested && (
              <div className="mb-8 flex items-start gap-3 sm:gap-4">
                <BackButton />
                <div className="min-w-0">
                  <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[34px]">{current.label}</h1>
                  <p className="mt-1.5 text-[15px] text-muted">{current.description}</p>
                </div>
              </div>
              )}
              {children}
            </motion.div>
            <MobileSignOut />
          </main>
        </div>
      </RequireAuth>
    </div>
  );
}

/** Round back button beside the section heading. */
function BackButton() {
  const router = useRouter();
  const returnTo = useReturnTo((s) => s.returnTo);

  return (
    <button
      type="button"
      // came from a page in this app → real "back" (section links use replace, so one step is enough);
      // opened directly (new tab, bookmark, after login) → home
      onClick={() => (returnTo ? router.back() : router.push("/"))}
      aria-label="Go back"
      title="Go back"
      className="group mt-0.5 grid size-9 shrink-0 place-items-center rounded-full border border-line bg-card text-ink/70 transition hover:border-ink/30 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:mt-1"
    >
      <ArrowLeft className="size-[18px] transition-transform duration-200 group-hover:-translate-x-0.5" />
    </button>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  const { user } = useAuth();
  const logout = useLogout();
  if (!user) return null;

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-28 space-y-6">
        <div className="flex items-center gap-3">
          <Avatar name={user.fullName} className="size-11 text-[14px]" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">{user.fullName}</p>
            <p className="truncate text-[13px] text-muted">{user.email}</p>
          </div>
        </div>

        <nav aria-label="Account sections" className="space-y-0.5">
          {items.map((item) => {
            const active = isActive(item.href, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                replace
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] transition-colors",
                  active ? "font-medium text-ink" : "text-ink/65 hover:bg-ink/[0.04] hover:text-ink",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="account-nav-active"
                    className="absolute inset-0 rounded-lg bg-card shadow-[0_1px_2px_rgb(22_22_20/0.06),0_0_0_1px_var(--line)]"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <Icon className={cn("relative size-[18px]", active ? "text-accent" : "text-muted")} />
                <span className="relative">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="h-px bg-line" />
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] text-ink/65 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
        >
          <LogOut className="size-[18px]" />
          {logout.isPending ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </aside>
  );
}

/** The sidebar (with its sign-out) is desktop-only, so phones get one at the bottom. */
function MobileSignOut() {
  const logout = useLogout();
  return (
    <div className="mt-12 border-t border-line pt-6 lg:hidden">
      <button
        type="button"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className="flex items-center gap-2.5 text-[14.5px] text-ink/65 transition-colors hover:text-red-600 disabled:opacity-60"
      >
        <LogOut className="size-[18px]" />
        {logout.isPending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

function MobileTabs({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Account sections"
      className="-mx-5 mb-8 flex gap-1 overflow-x-auto px-5 shadow-[inset_0_-1px_0_var(--line)] [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:hidden [&::-webkit-scrollbar]:hidden"
    >
      {items.map((t) => {
        const active = isActive(t.href, pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            replace
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative shrink-0 px-3 pb-3 pt-1 text-[14px] font-medium transition-colors",
              active ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            {t.label}
            {active && <motion.span layoutId="account-tab-active" className="absolute inset-x-0 bottom-0 h-0.5 bg-ink" />}
          </Link>
        );
      })}
    </nav>
  );
}

/** "/account" matches exactly; other sections also match their detail pages ("/account/tickets/…"). */
function isActive(href: string, pathname: string) {
  return pathname === href || (href !== "/account" && pathname.startsWith(`${href}/`));
}
