"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Button, LinkButton } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { useAuth, useLogout, useResendVerification } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/api/client";

const ease = [0.22, 1, 0.36, 1] as const;

export function HomeView() {
  const { status, user } = useAuth();
  const logout = useLogout();
  const resend = useResendVerification();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-1 flex-col px-5 sm:px-8">
      <header className="flex h-20 items-center justify-between border-b border-line">
        <Logo />
        <nav className="flex items-center gap-1">
          {status === "authenticated" ? (
            <Button variant="ghost" className="h-9 px-3" loading={logout.isPending} onClick={() => logout.mutate()}>
              Sign out
            </Button>
          ) : status === "guest" ? (
            <>
              <LinkButton href="/login" variant="ghost" className="h-9 px-3">
                Sign in
              </LinkButton>
              <LinkButton href="/register" className="h-9 px-4">
                Sign up
              </LinkButton>
            </>
          ) : null}
        </nav>
      </header>

      <main className="flex flex-1 items-center py-16">
        <AnimatePresence mode="wait">
          {status === "booting" && (
            <motion.div key="boot" exit={{ opacity: 0 }} className="mx-auto text-muted">
              <LoaderCircle className="size-5 animate-spin" aria-label="Loading" />
            </motion.div>
          )}

          {status === "guest" && (
            <motion.section
              key="guest"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease }}
              className="max-w-3xl"
            >
              <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted">
                <span className="mr-2 inline-block size-2 rounded-full bg-accent align-middle" />
                Now booking — winter season
              </p>
              <h1 className="mt-6 text-[clamp(2.75rem,7vw,5.5rem)] font-semibold leading-[0.95] tracking-[-0.05em]">
                Find something good to do this weekend.
              </h1>
              <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-muted">
                Concerts, comedy, film nights and conferences. Book in a few taps, and keep every ticket in one place.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <LinkButton href="/register" className="group h-12 px-6">
                  Create free account
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </LinkButton>
                <LinkButton href="/login" variant="secondary" className="h-12 px-6">
                  Sign in
                </LinkButton>
              </div>
            </motion.section>
          )}

          {status === "authenticated" && user && (
            <motion.section
              key="user"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease }}
              className="w-full max-w-xl"
            >
              <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted">Your account</p>
              <h1 className="mt-4 text-[44px] font-semibold leading-none tracking-[-0.045em]">
                Hi, {user.fullName.split(" ")[0]}.
              </h1>

              <dl className="mt-10 divide-y divide-line border-y border-line text-[15px]">
                {[
                  ["Name", user.fullName],
                  ["Email", user.email],
                  ["Role", <span key="r" className="capitalize">{user.role}</span>],
                  [
                    "Status",
                    user.emailVerified ? (
                      <span key="s" className="inline-flex items-center gap-2">
                        <span className="size-1.5 rounded-full bg-green-600" /> Verified
                      </span>
                    ) : (
                      <span key="s" className="inline-flex items-center gap-2">
                        <span className="size-1.5 rounded-full bg-accent" /> Email not verified
                      </span>
                    ),
                  ],
                ].map(([k, v]) => (
                  <div key={k as string} className="grid grid-cols-[120px_1fr] gap-4 py-3.5">
                    <dt className="text-muted">{k}</dt>
                    <dd className="min-w-0 truncate">{v}</dd>
                  </div>
                ))}
              </dl>

              {!user.emailVerified && (
                <div className="mt-8 rounded-xl bg-ink p-5 text-paper">
                  <p className="font-medium">Verify your email to book tickets</p>
                  <p className="mt-1 text-[14px] text-paper/60">We sent a link to {user.email}. It expires in 24 hours.</p>
                  <button
                    type="button"
                    disabled={resend.isPending}
                    onClick={() =>
                      resend.mutate(undefined, {
                        onSuccess: () => toast.success("Verification email sent"),
                        onError: (e) => toast.error(errorMessage(e)),
                      })
                    }
                    className="mt-4 text-[14px] font-medium underline decoration-accent decoration-2 underline-offset-4 disabled:opacity-60"
                  >
                    {resend.isPending ? "Sending…" : "Resend the email"}
                  </button>
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
