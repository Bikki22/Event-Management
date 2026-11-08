"use client";

import { Menu as MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { VerifyEmailBanner } from "@/components/auth/guards";
import { LinkButton, Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Avatar, Skeleton } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { accountNav, mainNav, mainNavFor } from "./nav-config";
import { SearchBox } from "./search-box";
import { UserMenu } from "./user-menu";

/**
 * Static stand-in shown while the real header (which reads the URL) streams in on dynamic routes
 * like /events/[slug]. Same size and layout, so nothing jumps.
 */
export function SiteHeaderFallback() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {mainNav.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-md px-3 py-1.5 text-[14px] text-muted hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <Skeleton className="size-8 rounded-full" />
        </div>
      </div>
    </header>
  );
}

export function SiteHeader() {
  const { status, user } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loginHref = pathname === "/" ? "/login" : `/login?next=${encodeURIComponent(pathname)}`;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
      <VerifyEmailBanner />
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {mainNavFor(user?.role).map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[14px] transition-colors",
                  active ? "font-medium text-ink" : "text-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <SearchBox className="ml-auto hidden w-full max-w-[280px] lg:block" />

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {status === "booting" ? (
            <Skeleton className="size-8 rounded-full" />
          ) : status === "authenticated" && user ? (
            <div className="hidden md:block">
              <UserMenu user={user} />
            </div>
          ) : (
            <div className="hidden items-center gap-1 md:flex">
              <LinkButton href={loginHref} variant="ghost" className="h-9 px-3">
                Sign in
              </LinkButton>
              <LinkButton href="/register" className="h-9 px-4">
                Sign up
              </LinkButton>
            </div>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="grid size-10 place-items-center rounded-lg text-ink transition hover:bg-ink/5 md:hidden"
          >
            <MenuIcon className="size-5" />
          </button>
        </div>
      </div>

      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} loginHref={loginHref} />
    </header>
  );
}

function MobileNav({ open, onClose, loginHref }: { open: boolean; onClose: () => void; loginHref: string }) {
  const { user } = useAuth();
  const logout = useLogout();
  const pathname = usePathname();

  const link = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      onClick={onClose}
      aria-current={pathname === href ? "page" : undefined}
      className={cn(
        "block rounded-lg px-3 py-2.5 text-[15px] transition-colors hover:bg-ink/5",
        pathname === href ? "font-medium text-ink" : "text-ink/80",
      )}
    >
      {label}
    </Link>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Menu">
      <div className="space-y-6 p-4">
        <SearchBox onSubmitted={onClose} />

        <nav aria-label="Main" className="space-y-0.5">
          {mainNavFor(user?.role).map((i) => link(i.href, i.label))}
        </nav>

        {user ? (
          <>
            <div className="flex items-center gap-3 border-t border-line px-3 pt-6">
              <Avatar name={user.fullName} />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium">{user.fullName}</p>
                <p className="truncate text-[12.5px] text-muted">{user.email}</p>
              </div>
            </div>
            <nav aria-label="Account" className="space-y-0.5">
              {accountNav(user.role).map((i) => link(i.href, i.label))}
            </nav>
            <Button
              variant="secondary"
              className="w-full"
              loading={logout.isPending}
              onClick={() => logout.mutate(undefined, { onSettled: onClose })}
            >
              Sign out
            </Button>
          </>
        ) : (
          <div className="flex flex-col gap-2 border-t border-line pt-6">
            <LinkButton href="/register" onClick={onClose}>
              Create account
            </LinkButton>
            <LinkButton href={loginHref} variant="secondary" onClick={onClose}>
              Sign in
            </LinkButton>
          </div>
        )}
      </div>
    </Sheet>
  );
}
