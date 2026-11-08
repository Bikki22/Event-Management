"use client";

import { BadgeCheck, CalendarPlus, QrCode, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Container } from "@/components/layout/page-header";
import { LinkButton } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { EmptyState, PageLoader } from "@/components/ui/primitives";
import { useAuth, useResendVerification } from "@/hooks/use-auth";
import { useOrganizerProfile } from "@/hooks/use-organizer";
import { errorMessage } from "@/lib/api/client";
import { OrganizerForm } from "./organizer-form";

const perks = [
  { icon: CalendarPlus, title: "Publish in minutes", text: "Create an event, add ticket types and go live once you're verified." },
  { icon: Wallet, title: "Get paid locally", text: "Buyers pay with Khalti, eSewa or card; payouts go to your wallet or bank." },
  { icon: QrCode, title: "Check guests in", text: "Scan tickets at the door with your phone; no extra hardware needed." },
];

export function ApplyView() {
  const { user } = useAuth();
  const profile = useOrganizerProfile();
  const resend = useResendVerification();

  if (profile.isPending) return <PageLoader />;

  if (profile.data) {
    return (
      <Container className="py-16">
        <EmptyState
          icon={<BadgeCheck className="size-5" />}
          title="You're already an organizer"
          description={`${profile.data.orgName} is set up. Manage your events and profile from your dashboard.`}
          action={<LinkButton href="/dashboard">Go to dashboard</LinkButton>}
        />
      </Container>
    );
  }

  return (
    <Container className="py-10 sm:py-16">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:gap-16">
        <div>
          <p className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted">
            <span className="mr-2 inline-block size-2 rounded-full bg-accent align-middle" />
            For organizers
          </p>
          <h1 className="mt-5 text-[clamp(2.5rem,5vw,4rem)] font-semibold leading-[0.98] tracking-[-0.05em]">
            Host your events on Book Event.
          </h1>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-muted">
            Tell us about your organization. Our team reviews new organizers, usually within a day, so buyers know who&apos;s
            behind every event.
          </p>
          <ul className="mt-10 space-y-6">
            {perks.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink text-accent">
                  <Icon className="size-[18px]" />
                </span>
                <span>
                  <span className="block text-[15.5px] font-medium">{title}</span>
                  <span className="block text-[14px] text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <ol className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6 font-mono text-[12px] uppercase tracking-[0.06em] text-muted">
            <li>1 · Apply</li>
            <li>2 · We review</li>
            <li>3 · Publish events</li>
          </ol>
        </div>

        <div className="rounded-2xl border border-line bg-card p-6 sm:p-8">
          <h2 className="text-[20px] font-semibold tracking-[-0.025em]">Your organization</h2>
          <p className="mt-1 text-[14px] text-muted">This is shown on your public page and on every event you publish.</p>
          {!user?.emailVerified && (
            <div className="mt-5">
              <FormAlert message="Verify your email before applying. We sent a link when you signed up.">
                <button
                  type="button"
                  disabled={resend.isPending}
                  onClick={() =>
                    resend.mutate(undefined, {
                      onSuccess: () => toast.success("Verification email sent"),
                      onError: (e) => toast.error(errorMessage(e)),
                    })
                  }
                  className="ml-1 font-medium underline underline-offset-4"
                >
                  {resend.isPending ? "Sending…" : "Resend email"}
                </button>
              </FormAlert>
            </div>
          )}
          <div className="mt-6">
            <OrganizerForm />
          </div>
        </div>
      </div>
    </Container>
  );
}
