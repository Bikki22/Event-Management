"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Ban, ExternalLink, Link2, MoreHorizontal, ScanLine, SearchX, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Textarea } from "@/components/ui/inputs";
import { Menu, MenuButton, MenuSeparator } from "@/components/ui/menu";
import { Badge, EmptyState, PageLoader } from "@/components/ui/primitives";
import { NavTabs } from "@/components/ui/tabs";
import { useCancelEvent, useDeleteEvent, useManageEvent } from "@/hooks/use-manage";
import { ApiError, errorMessage } from "@/lib/api/client";
import { STATUS, VISIBILITY, type ManageEvent } from "@/lib/api/manage";
import { formatEventDate } from "@/lib/format";
import { applyServerErrors } from "@/lib/form-errors";
import { cancelSchema, type CancelValues } from "@/lib/validation/event";

const Ctx = createContext<ManageEvent | null>(null);

/** The event loaded by the surrounding <EventManageShell>. */
export function useManagedEvent(): ManageEvent {
  const e = useContext(Ctx);
  if (!e) throw new Error("useManagedEvent must be used inside <EventManageShell>");
  return e;
}

/** Header, actions and section tabs shared by every page of one event. */
export function EventManageShell({ id, children }: { id: string; children: React.ReactNode }) {
  const query = useManageEvent(id);

  if (query.isPending) return <PageLoader />;
  if (query.isError) return <EmptyState title="We couldn't load this event" description={errorMessage(query.error)} />;
  if (!query.data) {
    return (
      <EmptyState
        icon={<SearchX className="size-5" />}
        title="Event not found"
        description="It may have been deleted, or it belongs to another organizer."
        action={<LinkButton href="/dashboard/events">Back to events</LinkButton>}
      />
    );
  }

  const e = query.data;
  const base = `/dashboard/events/${e.id}`;
  return (
    <Ctx.Provider value={e}>
      <Link href="/dashboard/events" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] text-muted transition hover:text-ink">
        <ArrowLeft className="size-3.5" /> All events
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS[e.status].tone} dot>
              {STATUS[e.status].label}
            </Badge>
            {e.visibility !== "public" && <Badge>{VISIBILITY[e.visibility].label}</Badge>}
          </div>
          <h1 className="mt-2 text-[28px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[32px]">{e.title}</h1>
          <p className="mt-1.5 text-[14px] text-muted">{formatEventDate(e.startsAt, e.endsAt, e.timezone)}</p>
        </div>
        <EventActions e={e} />
      </div>
      <NavTabs
        className="mb-8"
        items={[
          { href: base, label: "Event" },
          { href: `${base}/promo-codes`, label: "Promo codes" },
          { href: `${base}/attendees`, label: "Attendees" },
          { href: `${base}/staff`, label: "Door staff" },
        ]}
      />
      {children}
    </Ctx.Provider>
  );
}

function EventActions({ e }: { e: ManageEvent }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"cancel" | "delete" | null>(null);
  const del = useDeleteEvent(e.id);
  const viewable = e.status !== "draft" && e.visibility !== "private";
  const url = `/events/${e.slug}`;

  return (
    <div className="flex items-center gap-2">
      {e.status === "published" && (
        <LinkButton href={`/check-in/${e.id}`} variant="secondary" className="h-10">
          <ScanLine className="size-4" /> Scan tickets
        </LinkButton>
      )}
      {viewable && (
        <LinkButton href={url} target="_blank" variant="secondary" className="h-10">
          View page <ExternalLink className="size-3.5" />
        </LinkButton>
      )}
      {(viewable || e.status === "draft" || e.status === "published") && (
        <Menu
          trigger={(props) => (
            <button {...props} type="button" aria-label="More actions" className="grid size-10 place-items-center rounded-lg border border-line bg-card transition hover:border-ink/30">
              <MoreHorizontal className="size-4" />
            </button>
          )}
        >
          {viewable && (
            <MenuButton
              icon={<Link2 className="size-4" />}
              onSelect={() => {
                void navigator.clipboard?.writeText(new URL(url, window.location.origin).toString());
                toast.success("Link copied");
              }}
            >
              Copy event link
            </MenuButton>
          )}
          {e.status === "published" && (
            <>
              {viewable && <MenuSeparator />}
              <MenuButton icon={<Ban className="size-4" />} onSelect={() => setDialog("cancel")} danger>
                Cancel event
              </MenuButton>
            </>
          )}
          {e.status === "draft" && (
            <MenuButton icon={<Trash2 className="size-4" />} onSelect={() => setDialog("delete")} danger>
              Delete draft
            </MenuButton>
          )}
        </Menu>
      )}

      {dialog === "cancel" && <CancelDialog e={e} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        title="Delete this draft?"
        description="The draft and its ticket types are removed. This can't be undone."
        confirmLabel="Delete draft"
        destructive
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(undefined, {
            onSuccess: () => {
              toast.success("Draft deleted");
              router.replace("/dashboard/events");
            },
            onError: (err) => {
              setDialog(null);
              toast.error(errorMessage(err));
            },
          })
        }
      />
    </div>
  );
}

/** Cancelling refunds everyone, so it asks for a reason and the event title typed out. */
function CancelDialog({ e, onClose }: { e: ManageEvent; onClose: () => void }) {
  const cancel = useCancelEvent(e.id);
  const [formError, setFormError] = useState<string | null>(null);
  const sold = e.ticketTypes.reduce((n, t) => n + t.quantitySold, 0);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<CancelValues>({ resolver: zodResolver(cancelSchema), defaultValues: { reason: "", confirm: "" } });
  const confirm = useWatch({ control, name: "confirm" });
  const matches = confirm.trim().toLowerCase() === e.title.trim().toLowerCase();

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await cancel.mutateAsync(v.reason);
      toast.success("Event cancelled. Refunds are on their way to ticket holders.");
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_STATE") setFormError("Only published events can be cancelled.");
      else setFormError(applyServerErrors(err, setError, ["reason"]));
    }
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Cancel this event?"
      className="max-w-lg"
      description={
        <>
          The event comes off sale right away.{" "}
          {sold > 0 ? (
            <strong className="text-ink">
              All {sold.toLocaleString()} ticket{sold === 1 ? "" : "s"} sold will be refunded automatically
            </strong>
          ) : (
            "Any bookings are refunded automatically"
          )}
          , and every ticket holder gets an email with your reason. This can&apos;t be undone.
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormAlert message={formError} />
        <Textarea
          label="Reason (sent to ticket holders)"
          rows={3}
          placeholder="The venue is unavailable due to flooding."
          error={errors.reason?.message}
          {...register("reason")}
        />
        <Field
          label={`Type “${e.title}” to confirm`}
          autoComplete="off"
          error={errors.confirm?.message}
          {...register("confirm")}
        />
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={cancel.isPending}>
            Keep the event
          </Button>
          <Button type="submit" loading={cancel.isPending} disabled={!matches} className="bg-red-600 hover:bg-red-700">
            Cancel event and refund
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
