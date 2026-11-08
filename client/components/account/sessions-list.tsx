"use client";

import { Monitor, Smartphone } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Badge, Section, Skeleton } from "@/components/ui/primitives";
import { useRevokeSession, useSessions } from "@/hooks/use-account";
import { useLogout } from "@/hooks/use-auth";
import type { Session } from "@/lib/api/account";
import { errorMessage } from "@/lib/api/client";
import { describeUserAgent, formatIp, formatRelative } from "@/lib/format";

const isMobile = (ua: string | null) => !!ua && /Android|iPhone|iPad|Mobile/.test(ua);

export function SessionsList() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const logout = useLogout();
  const [target, setTarget] = useState<Session | null>(null);

  const others = sessions.data?.filter((s) => !s.current) ?? [];

  return (
    <div className="max-w-2xl">
      <Section
        title="Signed-in devices"
        description="Devices that are signed in to your account. Sign out any you don't recognise."
      >
        {sessions.isPending ? (
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
            ))}
          </div>
        ) : sessions.isError ? (
          <div className="flex items-center justify-between gap-4 text-[14px]">
            <p className="text-red-700">{errorMessage(sessions.error)}</p>
            <Button variant="secondary" className="h-9" onClick={() => sessions.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <ul className="-my-4 divide-y divide-line">
            <AnimatePresence initial={false}>
              {sessions.data.map((s) => {
                const Icon = isMobile(s.userAgent) ? Smartphone : Monitor;
                return (
                  <motion.li
                    key={s.id}
                    layout
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-center gap-4 overflow-hidden py-4"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink/[0.05] text-ink/70">
                      <Icon className="size-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-medium">
                        {describeUserAgent(s.userAgent)}
                        {s.current && (
                          <Badge tone="success" dot>
                            This device
                          </Badge>
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-[13px] text-muted">
                        {formatIp(s.ip)} · {s.current ? "Active now" : `Last active ${formatRelative(s.lastUsedAt)}`}
                      </p>
                    </div>
                    {s.current ? (
                      <Button variant="ghost" className="h-9 px-3" onClick={() => logout.mutate()} loading={logout.isPending}>
                        Sign out
                      </Button>
                    ) : (
                      <Button variant="secondary" className="h-9 px-3" onClick={() => setTarget(s)}>
                        Sign out
                      </Button>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </Section>

      {sessions.isSuccess && others.length === 0 && (
        <p className="mt-4 text-[13.5px] text-muted">You&apos;re only signed in on this device.</p>
      )}

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Sign out this device?"
        description={
          target && (
            <>
              <span className="font-medium text-ink">{describeUserAgent(target.userAgent)}</span> will need to sign in
              again to use your account.
            </>
          )
        }
        confirmLabel="Sign out device"
        destructive
        loading={revoke.isPending}
        onConfirm={() => {
          if (!target) return;
          revoke.mutate(target.id, {
            onSuccess: () => toast.success("Device signed out"),
            onError: (e) => toast.error(errorMessage(e)),
            onSettled: () => setTarget(null),
          });
        }}
      />
    </div>
  );
}
