"use client";

import { Lock, MailWarning } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, PageLoader } from "@/components/ui/primitives";
import { useAuth, useResendVerification } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/api/client";
import type { Role } from "@/lib/api/types";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Client-side gate for signed-in pages. The refresh cookie lives on the API origin,
 * so the Next server can't see the session: the API stays the real security boundary.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const endedReason = useAuthStore((s) => s.endedReason);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status !== "guest") return;
    // signing out on purpose goes home; anything else asks to sign in and come back
    if (endedReason === "logout") router.replace("/");
    // keep the query string too (e.g. a payment return URL carries the gateway reference)
    else router.replace(`/login?next=${encodeURIComponent(pathname + window.location.search)}`);
  }, [status, endedReason, pathname, router]);

  if (status !== "authenticated") return <PageLoader />;
  return <>{children}</>;
}

/** Use inside <RequireAuth>. Shows a friendly "not allowed" page for the wrong role. */
export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <PageLoader />;
  if (!roles.includes(user.role)) {
    const organizerOnly = !roles.includes("attendee") && roles.includes("organizer");
    return (
      <div className="mx-auto w-full max-w-xl py-16">
        <EmptyState
          icon={<Lock className="size-5" />}
          title={organizerOnly ? "This area is for organizers" : "You don't have access to this page"}
          description={
            organizerOnly
              ? "Apply to become an organizer to create events, sell tickets and manage attendees."
              : "If you think this is a mistake, contact an administrator."
          }
          action={
            organizerOnly ? (
              <LinkButton href="/organizer/apply">Become an organizer</LinkButton>
            ) : (
              <LinkButton href="/" variant="secondary">
                Back to home
              </LinkButton>
            )
          }
        />
      </div>
    );
  }
  return <>{children}</>;
}

/** Banner shown to signed-in users who haven't verified their email yet. */
export function VerifyEmailBanner() {
  const { user } = useAuth();
  const resend = useResendVerification();
  if (!user || user.emailVerified) return null;

  return (
    <div className="border-b border-line bg-ink text-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13.5px] sm:px-8">
        <MailWarning className="size-4 shrink-0 text-accent" aria-hidden />
        <p className="flex-1">
          Verify your email to book tickets. We sent a link to <span className="font-medium">{user.email}</span>.
        </p>
        <button
          type="button"
          disabled={resend.isPending}
          onClick={() =>
            resend.mutate(undefined, {
              onSuccess: () => toast.success("Verification email sent", { description: `Check ${user.email}` }),
              onError: (e) => toast.error(errorMessage(e)),
            })
          }
          className="font-medium underline decoration-accent decoration-2 underline-offset-4 disabled:opacity-60"
        >
          {resend.isPending ? "Sending…" : "Resend email"}
        </button>
      </div>
    </div>
  );
}
