"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { DashHeader } from "@/components/dashboard/app-shell";
import { LinkButton } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Badge, EmptyState, PageLoader } from "@/components/ui/primitives";
import { useOrganizerProfile } from "@/hooks/use-organizer";
import { errorMessage } from "@/lib/api/client";
import { VERIFICATION } from "@/lib/api/organizer";
import { OrganizerForm } from "./organizer-form";

export function OrganizerProfilePage() {
  const profile = useOrganizerProfile();
  if (profile.isPending) return <PageLoader />;
  if (profile.isError) return <EmptyState title="We couldn't load your profile" description={errorMessage(profile.error)} />;
  if (!profile.data)
    return (
      <EmptyState
        title="No organizer profile yet"
        action={<LinkButton href="/organizer/apply">Create organizer profile</LinkButton>}
      />
    );

  const p = profile.data;
  const v = VERIFICATION[p.verificationStatus];
  return (
    <>
      <DashHeader
        eyebrow="Organizer"
        title="Organizer profile"
        description="How buyers see you on your public page and on every event."
        action={
          <div className="flex items-center gap-3">
            <Badge tone={v.tone} dot>
              {v.label}
            </Badge>
            <Link
              href={`/organizers/${p.slug}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 text-[13.5px] font-medium underline underline-offset-4"
            >
              Public page <ExternalLink className="size-3.5" />
            </Link>
          </div>
        }
      />
      {p.verificationStatus === "rejected" && (
        <div className="mb-6">
          <FormAlert message={`Changes requested${p.reviewNote ? `: “${p.reviewNote}”` : "."} Saving your changes sends the profile back for review.`} />
        </div>
      )}
      <div className="max-w-2xl rounded-2xl border border-line bg-card p-6 sm:p-8">
        {/* key: reset the form when the saved profile changes (e.g. after a save) */}
        <OrganizerForm key={p.updatedAt} profile={p} />
      </div>
    </>
  );
}
