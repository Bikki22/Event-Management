"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, MoreHorizontal, Pencil, Plus, Ticket, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Textarea } from "@/components/ui/inputs";
import { Menu, MenuButton } from "@/components/ui/menu";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { useDeleteTicketType, useSaveTicketType, useToggleTicketType } from "@/hooks/use-manage";
import { ApiError, errorMessage } from "@/lib/api/client";
import { hasSales, type ManageEvent, type ManageTicketType, type TicketTypeInput } from "@/lib/api/manage";
import { applyServerErrors } from "@/lib/form-errors";
import { formatMoney, toPaisa } from "@/lib/format";
import { paisaToInput, ticketTypeSchema, type TicketTypeValues } from "@/lib/validation/event";
import { fromLocalInput, toLocalInput } from "@/lib/zoned";
import { cn } from "@/lib/utils";
import { ReadOnlyNote, StepFooter, type StepProps } from "./shared";

const FIELDS = ["name", "description", "price", "quantityTotal", "minPerOrder", "maxPerOrder", "salesStartAt", "salesEndAt", "isActive"] as const;

const ERROR_FIELD: Record<string, keyof TicketTypeValues> = {
  TICKET_TYPE_EXISTS: "name",
  PRICE_LOCKED: "price",
  QUANTITY_BELOW_SOLD: "quantityTotal",
  INVALID_SALES_WINDOW: "salesEndAt",
};

export function TicketsStep({ event, reload, goTo, readOnly }: StepProps) {
  const [editing, setEditing] = useState<ManageTicketType | "new" | null>(null);
  const [deleting, setDeleting] = useState<ManageTicketType | null>(null);
  const toggle = useToggleTicketType(event.id);
  const del = useDeleteTicketType(event.id);
  const types = event.ticketTypes;

  const onToggle = (t: ManageTicketType) =>
    toggle.mutate(
      { ttId: t.id, version: t.version, isActive: !t.isActive },
      {
        onSuccess: () => toast.success(t.isActive ? `${t.name} hidden from sale` : `${t.name} back on sale`),
        onError: (err) =>
          toast.error(
            err instanceof ApiError && err.code === "LAST_TICKET_TYPE"
              ? "A published event needs at least one ticket type on sale."
              : err instanceof ApiError && err.code === "PRECONDITION_FAILED"
                ? "That ticket type was just changed somewhere else. We reloaded it; try again."
                : errorMessage(err),
          ),
      },
    );

  return (
    <div>
      {readOnly && <ReadOnlyNote event={event} />}
      <section className="rounded-2xl border border-line bg-card">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.02em]">Tickets</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-muted">
              At least one ticket type on sale is needed to publish. Prices are in NPR; 0 makes it free.
            </p>
          </div>
          {!readOnly && types.length > 0 && (
            <Button variant="secondary" className="h-10" onClick={() => setEditing("new")}>
              <Plus className="size-4" /> Add ticket type
            </Button>
          )}
        </div>

        {types.length === 0 ? (
          <div className="px-5 pb-6 sm:px-6">
            <EmptyState
              icon={<Ticket className="size-5" />}
              title="No ticket types yet"
              description="Add General admission, VIP, Early bird… Each has its own price, quantity and sales window."
              action={!readOnly && <Button onClick={() => setEditing("new")}>Add a ticket type</Button>}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {types.map((t) => (
              <TicketRow
                key={t.id}
                t={t}
                event={event}
                readOnly={readOnly}
                onEdit={() => setEditing(t)}
                onToggle={() => onToggle(t)}
                onDelete={() => setDeleting(t)}
              />
            ))}
          </ul>
        )}
      </section>

      <StepFooter>
        <Button type="button" variant="ghost" onClick={() => goTo("cover")}>
          Back
        </Button>
        <Button type="button" onClick={() => goTo("publish")}>
          Continue
        </Button>
      </StepFooter>

      {editing && (
        <TicketTypeDialog
          event={event}
          ticketType={editing === "new" ? null : (types.find((t) => t.id === editing.id) ?? editing)}
          reload={reload}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? "ticket type"}?`}
        description="It's removed for good. This only works while nobody has bought or reserved it."
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(`${deleting.name} deleted`);
              setDeleting(null);
            },
            onError: (err) => {
              setDeleting(null);
              toast.error(
                err instanceof ApiError && err.code === "TICKET_TYPE_HAS_SALES"
                  ? "People already hold these tickets, so it can't be deleted. Hide it from sale instead."
                  : err instanceof ApiError && err.code === "LAST_TICKET_TYPE"
                    ? "A published event needs at least one ticket type."
                    : errorMessage(err),
              );
            },
          })
        }
      />
    </div>
  );
}

function TicketRow({
  t,
  event,
  readOnly,
  onEdit,
  onToggle,
  onDelete,
}: {
  t: ManageTicketType;
  event: ManageEvent;
  readOnly: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const sold = t.quantitySold;
  const pct = Math.min(100, ((sold + t.quantityReserved) / t.quantityTotal) * 100);
  const window = salesWindowLabel(t, event.timezone);

  return (
    <li className={cn("flex items-center gap-4 px-5 py-4 sm:px-6", !t.isActive && "bg-ink/[0.02]")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn("text-[15px] font-semibold", !t.isActive && "text-muted")}>{t.name}</p>
          {!t.isActive ? <Badge>Hidden</Badge> : t.soldOut ? <Badge tone="danger">Sold out</Badge> : t.onSale ? <Badge tone="success">On sale</Badge> : null}
        </div>
        <p className="mt-0.5 text-[13.5px] text-muted">
          {formatMoney(t.price, t.currency)}
          {` · ${t.minPerOrder === t.maxPerOrder ? t.maxPerOrder : `${t.minPerOrder}–${t.maxPerOrder}`} per order`}
          {window && ` · ${window}`}
        </p>
        <div className="mt-2.5 flex items-center gap-3">
          <div className="h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-ink/[0.07]">
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 text-[12.5px] text-muted">
            {sold.toLocaleString()} sold{t.quantityReserved > 0 && ` · ${t.quantityReserved} held`} / {t.quantityTotal.toLocaleString()}
          </span>
        </div>
      </div>
      {!readOnly && (
        <Menu
          trigger={(props) => (
            <button {...props} type="button" aria-label={`Actions for ${t.name}`} className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-ink/5 hover:text-ink">
              <MoreHorizontal className="size-4" />
            </button>
          )}
        >
          <MenuButton icon={<Pencil className="size-4" />} onSelect={onEdit}>
            Edit
          </MenuButton>
          <MenuButton icon={t.isActive ? <EyeOff className="size-4" /> : <Eye className="size-4" />} onSelect={onToggle}>
            {t.isActive ? "Hide from sale" : "Put back on sale"}
          </MenuButton>
          {!hasSales(t) && (
            <MenuButton icon={<Trash2 className="size-4" />} onSelect={onDelete} danger>
              Delete
            </MenuButton>
          )}
        </Menu>
      )}
    </li>
  );
}

function salesWindowLabel(t: ManageTicketType, timeZone: string): string | null {
  const f = new Intl.DateTimeFormat("en-NP", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
  if (t.salesStartAt && t.salesEndAt) return `sales ${f.format(new Date(t.salesStartAt))} – ${f.format(new Date(t.salesEndAt))}`;
  if (t.salesStartAt) return `sales open ${f.format(new Date(t.salesStartAt))}`;
  if (t.salesEndAt) return `sales close ${f.format(new Date(t.salesEndAt))}`;
  return null;
}

const valuesFrom = (t: ManageTicketType | null, tz: string): TicketTypeValues => ({
  name: t?.name ?? "",
  description: t?.description ?? "",
  price: t ? paisaToInput(t.price) : "",
  quantityTotal: t ? String(t.quantityTotal) : "",
  minPerOrder: String(t?.minPerOrder ?? 1),
  maxPerOrder: String(t?.maxPerOrder ?? 10),
  salesStartAt: toLocalInput(t?.salesStartAt, tz),
  salesEndAt: toLocalInput(t?.salesEndAt, tz),
  isActive: t?.isActive ?? true,
});

function TicketTypeDialog({
  event,
  ticketType,
  reload,
  onClose,
}: {
  event: ManageEvent;
  ticketType: ManageTicketType | null;
  reload: () => Promise<ManageEvent | null>;
  onClose: () => void;
}) {
  const tz = event.timezone;
  const save = useSaveTicketType(event.id);
  const [formError, setFormError] = useState<string | null>(null);
  const [base, setBase] = useState(ticketType?.version ?? 0);
  const locked = !!ticketType && hasSales(ticketType);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<TicketTypeValues>({ resolver: zodResolver(ticketTypeSchema), defaultValues: valuesFrom(ticketType, tz) });
  const price = useWatch({ control, name: "price" });
  const paisa = toPaisa(price ?? "");

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const body: TicketTypeInput = {
      name: v.name,
      description: v.description || (ticketType ? null : undefined),
      price: toPaisa(v.price)!,
      quantityTotal: Number(v.quantityTotal),
      minPerOrder: Number(v.minPerOrder),
      maxPerOrder: Number(v.maxPerOrder),
      salesStartAt: v.salesStartAt ? fromLocalInput(v.salesStartAt, tz) : ticketType ? null : undefined,
      salesEndAt: v.salesEndAt ? fromLocalInput(v.salesEndAt, tz) : ticketType ? null : undefined,
      isActive: v.isActive,
    };
    if (locked && ticketType && body.price === ticketType.price) delete (body as Partial<TicketTypeInput>).price;
    try {
      await save.mutateAsync({ ttId: ticketType?.id, version: base, body });
      toast.success(ticketType ? `${v.name} updated` : `${v.name} added`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "PRECONDITION_FAILED" && ticketType) {
        const fresh = (await reload())?.ticketTypes.find((t) => t.id === ticketType.id);
        if (fresh) setBase(fresh.version);
        setFormError("Someone changed this ticket type a moment ago. Your edits are still here; check them and save again.");
        return;
      }
      const at = err instanceof ApiError ? ERROR_FIELD[err.code] : undefined;
      if (at) return setError(at, { type: "server", message: (err as ApiError).message }, { shouldFocus: true });
      setFormError(applyServerErrors(err, setError, FIELDS));
    }
  });

  return (
    <Dialog open onClose={onClose} title={ticketType ? `Edit ${ticketType.name}` : "Add a ticket type"} className="max-w-lg">
      <form onSubmit={onSubmit} noValidate className="max-h-[70dvh] space-y-4 overflow-y-auto px-0.5 pb-0.5">
        <FormAlert message={formError} />
        <Field label="Name" placeholder="General admission" error={errors.name?.message} {...register("name")} />
        <Textarea
          label="Description"
          rows={2}
          placeholder="Front rows + welcome drink"
          labelAside={<span className="text-[12px] text-muted">Optional</span>}
          error={errors.description?.message}
          {...register("description")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Price (NPR)"
            inputMode="decimal"
            placeholder="1500"
            readOnly={locked}
            className={locked ? "bg-ink/[0.03] text-muted" : undefined}
            error={errors.price?.message}
            hint={
              <p className="text-[12.5px] text-muted">
                {locked ? "Locked: tickets are already sold or held." : paisa === 0 ? "Free ticket" : paisa ? formatMoney(paisa) : "0 for free"}
              </p>
            }
            {...register("price")}
          />
          <Field
            label="Quantity"
            inputMode="numeric"
            placeholder="300"
            error={errors.quantityTotal?.message}
            hint={
              ticketType && hasSales(ticketType) ? (
                <p className="text-[12.5px] text-muted">At least {ticketType.quantitySold + ticketType.quantityReserved} (sold + held)</p>
              ) : undefined
            }
            {...register("quantityTotal")}
          />
          <Field label="Min per order" inputMode="numeric" error={errors.minPerOrder?.message} {...register("minPerOrder")} />
          <Field label="Max per order" inputMode="numeric" error={errors.maxPerOrder?.message} {...register("maxPerOrder")} />
          <Field
            label="Sales start"
            type="datetime-local"
            labelAside={<span className="text-[12px] text-muted">Optional</span>}
            error={errors.salesStartAt?.message}
            {...register("salesStartAt")}
          />
          <Field
            label="Sales end"
            type="datetime-local"
            labelAside={<span className="text-[12px] text-muted">Optional</span>}
            error={errors.salesEndAt?.message}
            {...register("salesEndAt")}
          />
        </div>
        <p className="text-[12.5px] text-muted">
          Times are in {tz.replace(/_/g, " ")}. Leave sales dates empty to sell from publishing until the event ends.
        </p>
        <label className="flex items-center gap-2.5 text-[14px]">
          <input type="checkbox" className="size-4 accent-ink" {...register("isActive")} />
          On sale (uncheck to hide it without deleting)
        </label>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {ticketType ? "Save changes" : "Add ticket type"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
