"use client";

import { Check, Clock, ExternalLink, Store, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { DashHeader } from "@/components/dashboard/app-shell";
import { Avatar, Badge, EmptyState, PageLoader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useOrganizerProfile } from "@/hooks/use-organizer";
import { errorMessage } from "@/lib/api/client";
import { VERIFICATION, type OrganizerProfile } from "@/lib/api/organizer";
import { cn } from "@/lib/utils";

export function OrganizerOverview() {
  const { user } = useAuth();
  const profile = useOrganizerProfile();

  if (profile.isPending) return <PageLoader />;
  if (profile.isError) return <EmptyState title="We couldn't load your organizer profile" description={errorMessage(profile.error)} />;
  if (!profile.data) {
    // admins can open the dashboard without an organizer profile
    return (
      <EmptyState
        icon={<Store className="size-5" />}
        title="Set up an organizer profile first"
        description="Create your organizer profile to start publishing events."
        action={<LinkButton href="/organizer/apply">Create organizer profile</LinkButton>}
      />
    );
  }

  const p = profile.data;
  return (
    <>
      <DashHeader eyebrow="Organizer" title={`Hi, ${user?.fullName.split(" ")[0] ?? "there"}.`} description="Here's where your organizer account stands." />
      <StatusCard p={p} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Checklist p={p} />
        <PublicCard p={p} />
      </div>
    </>
  );
}

function StatusCard({ p }: { p: OrganizerProfile }) {
  const config = {
    pending: {
      icon: <Clock className="size-5 text-accent" />,
      title: "Your profile is being reviewed",
      text: "We usually review new organizers within a day. You can prepare draft events meanwhile; publishing unlocks once you're verified.",
      action: <LinkButton href="/dashboard/profile" variant="secondary" className="h-10">Review profile</LinkButton>,
    },
    verified: {
      icon: <Check className="size-5 text-accent" />,
      title: "You're verified",
      text: "Your events can go live. Buyers see a verified badge next to your name.",
      action: null,
    },
    rejected: {
      icon: <TriangleAlert className="size-5 text-accent" />,
      title: "Your profile needs changes",
      text: p.reviewNote ? `Note from our team: “${p.reviewNote}”` : "Update your profile and it goes back into review.",
      action: <LinkButton href="/dashboard/profile" className="h-10">Edit and resubmit</LinkButton>,
    },
  }[p.verificationStatus];

  return (
    <section className="flex flex-col gap-5 rounded-2xl bg-ink p-6 text-paper sm:flex-row sm:items-center">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-paper/10">{config.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[18px] font-semibold tracking-[-0.02em]">{config.title}</p>
        <p className="mt-1 text-[14.5px] leading-relaxed text-paper/65">{config.text}</p>
      </div>
      {config.action && <div className="[&_a]:bg-paper [&_a]:text-ink [&_a:hover]:bg-paper/90">{config.action}</div>}
    </section>
  );
}

function Checklist({ p }: { p: OrganizerProfile }) {
  const steps = [
    { done: true, title: "Create your organizer profile", href: "/dashboard/profile" },
    { done: !!p.logoUrl, title: "Add a logo", href: "/dashboard/profile" },
    { done: !!p.bio && !!p.website, title: "Write a short bio and add a website", href: "/dashboard/profile" },
    { done: !!p.payout, title: "Add payout details", href: "/dashboard/payouts" },
    { done: p.verificationStatus === "verified", title: "Get verified by our team", href: null },
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <section className="rounded-2xl border border-line bg-card">
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
        <h2 className="text-[16px] font-semibold tracking-[-0.015em]">Setup</h2>
        <span className="font-mono text-[12px] text-muted">
          {done}/{steps.length} done
        </span>
      </div>
      <div className="h-1 bg-line">
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ul className="divide-y divide-line">
        {steps.map((s) => {
          const body = (
            <>
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border",
                  s.done ? "border-ink bg-ink text-paper" : "border-line text-transparent",
                )}
              >
                <Check className="size-3.5" />
              </span>
              <span className={cn("flex-1 text-[14.5px]", s.done && "text-muted line-through decoration-ink/20")}>{s.title}</span>
            </>
          );
          return (
            <li key={s.title}>
              {s.href && !s.done ? (
                <Link href={s.href} className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-ink/[0.02]">
                  {body}
                  <span className="text-[13px] font-medium text-ink/60">Do it →</span>
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-5 py-3.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PublicCard({ p }: { p: OrganizerProfile }) {
  const v = VERIFICATION[p.verificationStatus];
  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <div className="flex items-center gap-3">
        <Avatar name={p.orgName} src={p.logoUrl} className="size-12 rounded-xl" />
        <div className="min-w-0">
          <p className="truncate text-[15.5px] font-semibold">{p.orgName}</p>
          <Badge tone={v.tone} className="mt-1">
            {v.label}
          </Badge>
        </div>
      </div>
      {p.bio && <p className="mt-4 line-clamp-3 text-[13.5px] leading-relaxed text-muted">{p.bio}</p>}
      {p.verificationStatus !== "rejected" && (
        <Link
          href={`/organizers/${p.slug}`}
          target="_blank"
          className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink underline decoration-accent decoration-2 underline-offset-4"
        >
          View public page <ExternalLink className="size-3.5" />
        </Link>
      )}
    </section>
  );
}
