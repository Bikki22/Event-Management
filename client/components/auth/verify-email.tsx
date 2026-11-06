"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleCheckBig, LoaderCircle, MailWarning } from "lucide-react";
import { motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AuthHeader } from "@/components/auth/auth-header";
import { Button, LinkButton } from "@/components/ui/button";
import { useAuth, useResendVerification } from "@/hooks/use-auth";
import { authApi } from "@/lib/api/auth";
import { errorMessage } from "@/lib/api/client";
import { useAuthStore } from "@/stores/auth-store";

export function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const { isAuthenticated } = useAuth();
  const resend = useResendVerification();

  // a query (not an effect) dedupes the call: the token is single-use, so it must run exactly once
  const verify = useQuery({
    queryKey: ["verify-email", token],
    queryFn: async () => {
      const { user } = await authApi.verifyEmail(token);
      const store = useAuthStore.getState();
      if (store.user?.id === user.id) store.setUser(user);
      return user;
    },
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (!token || verify.isError) {
    return (
      <Panel icon={<MailWarning className="size-5 text-ink" />}>
        <AuthHeader
          title="We couldn't verify that link"
          subtitle={
            verify.isError
              ? `${errorMessage(verify.error)} Verification links work once and expire after 24 hours.`
              : "This link is missing its token. Open the link from your email again."
          }
        />
        <div className="flex flex-col gap-3">
          {isAuthenticated ? (
            <Button
              loading={resend.isPending}
              onClick={() =>
                resend.mutate(undefined, {
                  onSuccess: () => toast.success("New verification email sent"),
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              Send a new link
            </Button>
          ) : (
            <LinkButton href="/login" className="w-full">
              Sign in to get a new link
            </LinkButton>
          )}
        </div>
      </Panel>
    );
  }

  if (verify.isPending) {
    return (
      <Panel icon={<LoaderCircle className="size-5 animate-spin text-ink" />}>
        <AuthHeader title="Verifying your email…" subtitle="This only takes a second." />
      </Panel>
    );
  }

  return (
    <Panel icon={<CircleCheckBig className="size-5 text-paper" />} done>
      <AuthHeader
        title="Email verified"
        subtitle={`Thanks${verify.data.fullName ? `, ${verify.data.fullName.split(" ")[0]}` : ""}! You can now book tickets and apply to become an organizer.`}
      />
      <LinkButton href={isAuthenticated ? "/" : "/login"} className="w-full">
        {isAuthenticated ? "Continue" : "Sign in"}
      </LinkButton>
    </Panel>
  );
}


function Panel({ icon, done, children }: { icon: React.ReactNode; done?: boolean; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className={`mb-6 grid size-11 place-items-center rounded-full ${done ? "bg-ink" : "border border-line bg-card"}`}
      >
        {icon}
      </motion.div>
      {children}
    </motion.div>
  );
}
