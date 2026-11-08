"use client";

import { Check, CircleAlert, ExternalLink, PartyPopper, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Badge } from "@/components/ui/primitives";
import { useNow } from "@/hooks/use-now";
import { usePublishEvent } from "@/hooks/use-manage";
import { useOrganizerProfile } from "@/hooks/use-organizer";
import { ApiError, errorMessage } from "@/lib/api/client";
import { MODE_LABEL } from "@/lib/api/events";
import { VISIBILITY, type ManageEvent } from "@/lib/api/manage";
import { formatEventDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StepFooter, type StepId, type StepProps } from "./shared";

interface PublishCheck {
  key: string;
  label: string;
  ok: boolean;
  step?: StepId;
  href?: string;
  optional?: boolean;
}

/** Same checks as POST /events/{id}/publish (events.service.ts), plus the cover as a nice-to-have. */
function checksFor(e: ManageEvent, now: number | null, verified: boolean | undefined): PublishCheck[] {
  const list: PublishCheck[] = [
    { key: "summary", label: "Summary", ok: !!e.summary, step: "basics" },
    { key: "categoryId", label: "Category", ok: !!e.categoryId, step: "basics" },
    { key: "startsAt", label: "Start time in the future", ok: now === null || new Date(e.startsAt).getTime() > now, step: "schedule" },
  ];
  if (e.mode !== "online") list.push({ key: "venueId", label: "Venue", ok: !!e.venueId, step: "schedule" });
  if (e.mode !== "in_person") list.push({ key: "onlineUrl", label: "Online link", ok: !!e.onlineUrl, step: "schedule" });
  list.push(
    { key: "ticketTypes", label: "At least one ticket type on sale", ok: e.ticketTypes.some((t) => t.isActive), step: "tickets" },
    { key: "cover", label: "Cover image (recommended)", ok: !!e.coverImage, step: "cover", optional: true },
  );
  if (verified !== undefined) {
    list.push({ key: "verified", label: "Organizer profile verified by our team", ok: verified, href: "/dashboard" });
  }
  return list;
}

/** `details.missing` entries look like "summary" or "ticketTypes (at least one active)". */
const missingKey = (m: string) => m.split(/[\s(]/)[0];

export function PublishStep({ event, goTo }: StepProps) {
  const now = useNow();
  const profile = useOrganizerProfile();
  const publish = usePublishEvent(event.id);
  const [error, setError] = useState<string | null>(null);
  const [serverMissing, setServerMissing] = useState<string[]>([]);

  const verified = profile.data ? profile.data.verificationStatus === "verified" : undefined;
  const checks = checksFor(event, now, verified).map((c) => (serverMissing.includes(c.key) ? { ...c, ok: false } : c));
  const blocking = checks.filter((c) => !c.ok && !c.optional);

  const onPublish = () => {
    setError(null);
    setServerMissing([]);
    publish.mutate(undefined, {
      onSuccess: () => toast.success("Your event is live"),
      onError: (err) => {
        if (err instanceof ApiError && err.code === "EVENT_INCOMPLETE") {
          const missing = ((err.details as { missing?: string[] } | undefined)?.missing ?? []).map(missingKey);
          setServerMissing(missing);
          setError("A few things are still missing. Fix the items marked below and publish again.");
        } else if (err instanceof ApiError && err.code === "ORGANIZER_NOT_VERIFIED") {
          setError("Your organizer profile isn't verified yet. You can publish as soon as our team approves it.");
        } else {
          setError(errorMessage(err));
        }
      },
    });
  };

  if (event.status !== "draft") return <LiveState event={event} />;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em]">Review and publish</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">
          Publishing makes the event bookable{event.visibility === "public" ? " and lists it in search" : ""}. You can still edit details afterwards; the event address is locked.
        </p>
        <div className="mt-5">
          <FormAlert message={error} />
        </div>
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {checks.map((c) => (
            <li key={c.key} className="flex items-center gap-3 px-4 py-3">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full",
                  c.ok ? "bg-ink text-paper" : c.optional ? "bg-ink/[0.06] text-ink/50" : "bg-red-500/10 text-red-600",
                )}
              >
                {c.ok ? <Check className="size-3.5" /> : c.optional ? <CircleAlert className="size-3.5" /> : <X className="size-3.5" />}
              </span>
              <span className={cn("flex-1 text-[14.5px]", c.ok && "text-muted")}>{c.label}</span>
              {!c.ok && c.step && (
                <button type="button" onClick={() => goTo(c.step!)} className="text-[13px] font-medium text-ink underline decoration-accent decoration-2 underline-offset-4">
                  Fix
                </button>
              )}
              {!c.ok && c.href && (
                <Link href={c.href} className="text-[13px] font-medium text-ink/60 hover:text-ink">
                  Status
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Preview event={event} />

      <StepFooter>
        <Button type="button" variant="ghost" onClick={() => goTo("tickets")}>
          Back
        </Button>
        <Button type="button" onClick={onPublish} loading={publish.isPending} disabled={blocking.length > 0}>
          Publish event
        </Button>
      </StepFooter>
    </div>
  );
}

function Preview({ event }: { event: ManageEvent }) {
  const active = event.ticketTypes.filter((t) => t.isActive);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      {event.coverImage && (
        // eslint-disable-next-line @next/next/no-img-element -- processed variant from our storage
        <img src={event.coverImage.md} alt="" className="aspect-[16/6] w-full object-cover" />
      )}
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap gap-2">
          {event.category && <Badge>{event.category.name}</Badge>}
          <Badge>{VISIBILITY[event.visibility].label}</Badge>
        </div>
        <h3 className="mt-3 text-[22px] font-semibold tracking-[-0.03em]">{event.title}</h3>
        {event.summary && <p className="mt-1 text-[14.5px] text-muted">{event.summary}</p>}
        <dl className="mt-5 grid gap-4 text-[14px] sm:grid-cols-2">
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-muted">When</dt>
            <dd className="mt-0.5">{formatEventDate(event.startsAt, event.endsAt, event.timezone)}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-muted">Where</dt>
            <dd className="mt-0.5">{event.venue ? `${event.venue.name}, ${event.venue.city}` : MODE_LABEL[event.mode]}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[12px] uppercase tracking-wide text-muted">Tickets</dt>
            <dd className="mt-0.5">
              {active.length === 0
                ? "None on sale"
                : active.map((t) => `${t.name} · ${formatMoney(t.price, t.currency)} · ${t.quantityTotal.toLocaleString()}`).join("  /  ")}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function LiveState({ event }: { event: ManageEvent }) {
  if (event.status === "cancelled") {
    const p = event.refundProgress;
    return (
      <section className="rounded-2xl border border-line bg-card p-6">
        <Badge tone="danger" dot>
          Cancelled
        </Badge>
        <h2 className="mt-3 text-[19px] font-semibold tracking-[-0.02em]">This event was cancelled</h2>
        {event.cancellationReason && <p className="mt-1 text-[14.5px] text-muted">Reason: “{event.cancellationReason}”</p>}
        {p && (
          <p className="mt-4 text-[14px]">
            Refunds: <strong>{p.refunded}</strong> refunded, <strong>{p.cancelled}</strong> unpaid bookings cancelled
            {p.remaining > 0 ? `, ${p.remaining} still in progress` : ", all done"}.
          </p>
        )}
      </section>
    );
  }
  return (
    <section className="flex flex-col items-start gap-4 rounded-2xl bg-ink p-6 text-paper sm:flex-row sm:items-center">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-paper/10">
        <PartyPopper className="size-5 text-accent" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[18px] font-semibold tracking-[-0.02em]">{event.status === "completed" ? "This event has ended" : "Your event is live"}</p>
        <p className="mt-1 text-[14.5px] text-paper/65">
          {event.status === "completed"
            ? "Thanks for hosting. Attendee lists and exports stay available."
            : event.visibility === "public"
              ? "It's listed in search and on your organizer page. Edits you save show up within a minute."
              : `It's ${VISIBILITY[event.visibility].label.toLowerCase()}: ${VISIBILITY[event.visibility].hint.toLowerCase()}`}
        </p>
      </div>
      {event.status === "published" && event.visibility !== "private" && (
        <Link
          href={`/events/${event.slug}`}
          target="_blank"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-paper px-4 text-[14px] font-medium text-ink transition hover:bg-paper/90"
        >
          View event page <ExternalLink className="size-3.5" />
        </Link>
      )}
    </section>
  );
}
