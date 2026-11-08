"use client";

import { BadgeCheck, Check, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { DashHeader } from "@/components/dashboard/app-shell";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Textarea } from "@/components/ui/inputs";
import { Avatar, Badge, EmptyState, Skeleton } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/tabs";
import { useAdminOrganizers, useReviewOrganizer } from "@/hooks/use-admin";
import { useDebounced } from "@/hooks/use-manage";
import type { AdminOrganizer } from "@/lib/api/admin";
import { errorMessage } from "@/lib/api/client";
import { VERIFICATION, type VerificationStatus } from "@/lib/api/organizer";
import { formatDate, formatRelative } from "@/lib/format";

type Filter = VerificationStatus | "all";

export function AdminOrganizers() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim(), 300);
  const list = useAdminOrganizers({ status: filter === "all" ? undefined : filter, q: search || undefined });
  const [rejecting, setRejecting] = useState<AdminOrganizer | null>(null);

  return (
    <>
      <DashHeader eyebrow="Admin" title="Organizers" description="Verify new organizers so they can publish events. Rejections go back to them with your note." />
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { value: "pending", label: "Waiting for review" },
            { value: "verified", label: "Verified" },
            { value: "rejected", label: "Changes needed" },
            { value: "all", label: "All" },
          ]}
          className="overflow-x-auto [scrollbar-width:none]"
        />
        <SearchInput value={q} onChange={setQ} placeholder="Name, address or owner email" label="Search organizers" busy={list.isFetching && !list.isFetchingNextPage} className="sm:w-72" />
      </div>

      {list.isPending ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : list.isError ? (
        <EmptyState title="We couldn't load organizers" description={errorMessage(list.error)} />
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={<BadgeCheck className="size-5" />}
          title={filter === "pending" && !search ? "All caught up" : "No organizers match"}
          description={filter === "pending" && !search ? "No profiles are waiting for review." : undefined}
        />
      ) : (
        <>
          <ul className="space-y-3">
            {list.rows.map((o) => (
              <OrganizerCard key={o.userId} o={o} onReject={() => setRejecting(o)} />
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      {rejecting && <RejectDialog o={rejecting} onClose={() => setRejecting(null)} />}
    </>
  );
}

function OrganizerCard({ o, onReject }: { o: AdminOrganizer; onReject: () => void }) {
  const review = useReviewOrganizer();
  const v = VERIFICATION[o.verificationStatus];
  const approve = () =>
    review.mutate(
      { userId: o.userId, status: "verified" },
      { onSuccess: () => toast.success(`${o.orgName} is verified`), onError: (err) => toast.error(errorMessage(err)) },
    );

  return (
    <li className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Avatar name={o.orgName} src={o.logoUrl} className="size-12 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[16px] font-semibold tracking-[-0.015em]">{o.orgName}</p>
            <Badge tone={v.tone}>{v.label}</Badge>
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            {o.owner.fullName} · {o.owner.email}
            {!o.owner.emailVerified && " · email not verified"}
            {o.owner.status !== "active" && ` · account ${o.owner.status}`}
          </p>
          {o.bio && <p className="mt-3 line-clamp-3 text-[14px] leading-relaxed">{o.bio}</p>}
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
            <div>
              <dt className="sr-only">Address</dt>
              <dd className="font-mono">/organizers/{o.slug}</dd>
            </div>
            {o.website && (
              <div>
                <dt className="sr-only">Website</dt>
                <dd>
                  <a href={o.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink">
                    {o.website.replace(/^https?:\/\//, "")} <ExternalLink className="size-3" />
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt className="sr-only">Payout</dt>
              <dd>{o.payout ? `Payout: ${o.payout.method === "bank" ? o.payout.bankName : o.payout.method}` : "No payout details"}</dd>
            </div>
            <div>
              <dt className="sr-only">Applied</dt>
              <dd title={formatDate(o.createdAt)}>Applied {formatRelative(o.createdAt)}</dd>
            </div>
          </dl>
          {o.reviewNote && o.verificationStatus === "rejected" && (
            <p className="mt-3 rounded-lg bg-ink/[0.04] px-3 py-2 text-[13px]">
              <span className="font-medium">Note sent:</span> {o.reviewNote}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2 sm:flex-col">
          {o.verificationStatus !== "verified" && (
            <Button className="h-10" onClick={approve} loading={review.isPending}>
              <Check className="size-4" /> Verify
            </Button>
          )}
          {o.verificationStatus !== "rejected" && (
            <Button variant="secondary" className="h-10" onClick={onReject} disabled={review.isPending}>
              <X className="size-4" /> {o.verificationStatus === "verified" ? "Revoke" : "Reject"}
            </Button>
          )}
          {o.verificationStatus === "verified" && (
            <Link href={`/organizers/${o.slug}`} target="_blank" className="inline-flex h-10 items-center justify-center gap-1.5 px-3 text-[13.5px] text-muted hover:text-ink">
              Public page <ExternalLink className="size-3.5" />
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

function RejectDialog({ o, onClose }: { o: AdminOrganizer; onClose: () => void }) {
  const review = useReviewOrganizer();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const revoking = o.verificationStatus === "verified";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 1) return setError("Tell them what to change. They see this note.");
    review.mutate(
      { userId: o.userId, status: "rejected", note: note.trim() },
      {
        onSuccess: () => {
          toast.success(revoking ? `Verification revoked for ${o.orgName}` : `Sent back to ${o.orgName}`);
          onClose();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={revoking ? `Revoke ${o.orgName}'s verification?` : `Send ${o.orgName} back for changes?`}
      description={
        revoking
          ? "They won't be able to publish new events until they're verified again. Events already live stay live."
          : "They'll see your note on their dashboard, can edit their profile and it comes back to this list."
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormAlert message={error} />
        <Textarea
          label="Note to the organizer"
          rows={4}
          maxLength={500}
          placeholder="e.g. Please add a website or social link so we can confirm who you are."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          labelAside={<span className="text-[12px] text-muted">{note.length}/500</span>}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={review.isPending} className="bg-red-600 hover:bg-red-700">
            {revoking ? "Revoke verification" : "Send back"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
