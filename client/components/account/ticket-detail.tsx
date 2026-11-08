"use client";

import { ArrowLeft, Download, ExternalLink, MapPin, Receipt, Sun, UserPen, Video } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { CoverImage } from "@/components/events/cover-image";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Badge, EmptyState, PageLoader } from "@/components/ui/primitives";
import { useDownloadPdf, useSetHolder, useTicket } from "@/hooks/use-my-tickets";
import { useNow } from "@/hooks/use-now";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/api/client";
import { TICKET_STATUS, type TicketDetail as Ticket } from "@/lib/api/tickets";
import { formatEventDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export function TicketDetail({ id }: { id: string }) {
  const ticket = useTicket(id);

  if (ticket.isPending) return <PageLoader />;
  if (ticket.isError) {
    return (
      <EmptyState
        title="We couldn't open this ticket"
        description={errorMessage(ticket.error)}
        action={<LinkButton href="/account/tickets">Back to my tickets</LinkButton>}
      />
    );
  }
  return <TicketView t={ticket.data} />;
}

function TicketView({ t }: { t: Ticket }) {
  const { user } = useAuth();
  const now = useNow();
  const pdf = useDownloadPdf();
  const [holderOpen, setHolderOpen] = useState(false);

  const usable = t.status === "valid" || t.status === "checked_in";
  const started = now !== null && new Date(t.event.startsAt).getTime() <= now;
  const canReassign = t.status === "valid" && !started;
  const status = TICKET_STATUS[t.status];

  return (
    <div>
      <Link href="/account/tickets" className="inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> My tickets
      </Link>

      <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] xl:gap-12">
        {/* the ticket */}
        <article
          aria-label={`Ticket for ${t.event.title}`}
          className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-2xl border border-line bg-card shadow-[0_24px_60px_-32px_rgb(22_22_20/0.4)]"
        >
          <CoverImage image={t.event.coverImage} alt="" sizes="420px" />
          <div className="p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{t.ticketType.name}</p>
            <h1 className="mt-1.5 text-[24px] font-semibold leading-tight tracking-[-0.03em]">{t.event.title}</h1>
            <p className="mt-2 text-[14px] text-ink/80">{formatEventDate(t.event.startsAt, t.event.endsAt, t.event.timezone)}</p>
            <p className="mt-1 flex items-start gap-1.5 text-[14px] text-muted">
              {t.event.mode === "online" ? <Video className="mt-0.5 size-4 shrink-0" /> : <MapPin className="mt-0.5 size-4 shrink-0" />}
              {t.event.mode === "online"
                ? "Online event"
                : t.event.venue
                  ? `${t.event.venue.name}, ${[t.event.venue.addressLine, t.event.venue.city].filter(Boolean).join(", ")}`
                  : "Venue to be announced"}
            </p>
          </div>

          {/* perforation */}
          <div className="relative h-0" aria-hidden>
            <span className="absolute -left-3 -top-3 size-6 rounded-full border border-line bg-paper" />
            <span className="absolute -right-3 -top-3 size-6 rounded-full border border-line bg-paper" />
            <span className="absolute inset-x-6 top-0 border-t-2 border-dashed border-line" />
          </div>

          <div className="p-6 pt-7">
            <div className="relative mx-auto w-fit">
              <div className={cn("rounded-xl bg-white p-3", !usable && "opacity-25")}>
                <div
                  className="size-[200px] [&>svg]:size-full"
                  role="img"
                  aria-label={`QR code for ticket ${t.ticketCode}`}
                  // server-generated SVG of the ticket code
                  dangerouslySetInnerHTML={{ __html: t.qr.svg }}
                />
              </div>
              {!usable && (
                <p className="absolute inset-0 m-auto h-fit w-fit -rotate-12 rounded-md border-2 border-red-600 bg-card/80 px-3 py-1 font-mono text-[18px] font-bold uppercase tracking-widest text-red-600">
                  {status.label}
                </p>
              )}
            </div>
            <p className="mt-4 text-center font-mono text-[15px] font-semibold tracking-[0.06em]">{t.ticketCode}</p>

            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-5 text-[13.5px]">
              <div>
                <dt className="text-muted">Holder</dt>
                <dd className="mt-0.5 font-medium">{t.holderName ?? user?.fullName ?? "You"}</dd>
              </div>
              <div>
                <dt className="text-muted">Status</dt>
                <dd className="mt-1">
                  <Badge tone={status.tone}>{status.label}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted">Booking</dt>
                <dd className="mt-0.5 font-mono">{t.bookingCode}</dd>
              </div>
              {t.checkedInAt && (
                <div>
                  <dt className="text-muted">Checked in</dt>
                  <dd className="mt-0.5">{formatRelative(t.checkedInAt)}</dd>
                </div>
              )}
            </dl>
          </div>
        </article>

        {/* actions */}
        <div className="space-y-4">
          {usable && (
            <p className="flex items-start gap-2.5 rounded-xl bg-ink px-4 py-3 text-[14px] text-paper">
              <Sun className="mt-0.5 size-4 shrink-0 text-accent" />
              Show this QR code at the door. Turn your screen brightness up so it scans first time.
            </p>
          )}
          {t.event.status === "cancelled" && (
            <FormAlert message="This event was cancelled. Paid bookings are refunded automatically." />
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {usable && (
              <ActionCard
                icon={<Download className="size-[18px]" />}
                title="Download PDF"
                description={t.pdfReady ? "Print it or keep it offline." : "Being prepared; this can take a few seconds."}
                onClick={() =>
                  pdf.mutate(t.id, {
                    onError: (e) => toast.error(errorMessage(e)),
                  })
                }
                loading={pdf.isPending}
              />
            )}
            {canReassign && (
              <ActionCard
                icon={<UserPen className="size-[18px]" />}
                title={t.holderName ? "Change guest" : "Give to a guest"}
                description="Put someone else's name on this ticket."
                onClick={() => setHolderOpen(true)}
              />
            )}
            {t.event.onlineUrl && (
              <ActionCard
                icon={<ExternalLink className="size-[18px]" />}
                title="Join online"
                description="Your private link to the stream."
                href={t.event.onlineUrl}
              />
            )}
            <ActionCard
              icon={<Receipt className="size-[18px]" />}
              title="View booking"
              description={`Order ${t.bookingCode}, payment and refunds.`}
              href="/account/bookings"
              internal
            />
          </div>

          <p className="text-[13px] text-muted">
            Organized by{" "}
            <Link href={`/organizers/${t.event.organizer.slug}`} className="text-ink underline underline-offset-4">
              {t.event.organizer.orgName}
            </Link>{" "}
            ·{" "}
            <Link href={`/events/${t.event.slug}`} className="text-ink underline underline-offset-4">
              Event page
            </Link>
          </p>
        </div>
      </div>

      {canReassign && <HolderDialog ticket={t} open={holderOpen} onClose={() => setHolderOpen(false)} />}
    </div>
  );
}

function ActionCard({
  icon,
  title,
  description,
  onClick,
  href,
  internal,
  loading,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
  href?: string;
  internal?: boolean;
  loading?: boolean;
}) {
  const body = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink/[0.05] text-ink">
        {loading ? <span className="size-4 animate-spin rounded-full border-2 border-ink/20 border-t-ink" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block text-[13px] text-muted">{description}</span>
      </span>
    </>
  );
  const cls =
    "flex items-center gap-3.5 rounded-2xl border border-line bg-card p-4 text-left transition hover:border-ink/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60";
  if (href && internal)
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  if (href)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {body}
      </a>
    );
  return (
    <button type="button" onClick={onClick} disabled={loading} className={cls}>
      {body}
    </button>
  );
}

function HolderDialog({ ticket, open, onClose }: { ticket: Ticket; open: boolean; onClose: () => void }) {
  const save = useSetHolder(ticket.id);
  const [name, setName] = useState(ticket.holderName ?? "");
  const [email, setEmail] = useState(ticket.holderEmail ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const m = email.trim();
    if (!n) return setError("Enter the guest's name");
    if (m && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) return setError("Enter a valid email or leave it empty");
    setError(null);
    save.mutate(
      { holderName: n, holderEmail: m || null },
      {
        onSuccess: () => {
          toast.success("Ticket updated", { description: `It's now in ${n}'s name. A new PDF is being prepared.` });
          onClose();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Give this ticket to a guest"
      description="Their name appears on the ticket and to door staff. You still manage the ticket from your account."
    >
      <form onSubmit={submit} className="space-y-4">
        <FormAlert message={error} />
        <Field label="Guest's full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-autofocus />
        <Field
          label="Guest's email"
          type="email"
          labelAside={<span className="text-[12px] text-muted">Optional</span>}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
