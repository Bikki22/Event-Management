"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MoreHorizontal, Pencil, Plus, Power, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/inputs";
import { Menu, MenuButton } from "@/components/ui/menu";
import { Badge, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useNow } from "@/hooks/use-now";
import { useDeletePromo, usePromoCodes, useSavePromo, useTogglePromo } from "@/hooks/use-manage";
import { ApiError, errorMessage } from "@/lib/api/client";
import { isReadOnly, type ManageEvent, type PromoCode, type PromoInput } from "@/lib/api/manage";
import { applyServerErrors } from "@/lib/form-errors";
import { formatMoney, toPaisa } from "@/lib/format";
import { paisaToInput, promoSchema, type PromoValues } from "@/lib/validation/event";
import { fromLocalInput, toLocalInput } from "@/lib/zoned";
import { cn } from "@/lib/utils";
import { useManagedEvent } from "./event-manage-shell";

const FIELDS = ["code", "discountType", "discountValue", "maxRedemptions", "validFrom", "validUntil", "isActive"] as const;

const discountLabel = (p: PromoCode) => (p.discountType === "percent" ? `${p.discountValue}% off` : `${formatMoney(p.discountValue)} off`);

function promoState(p: PromoCode, now: number | null): { label: string; tone: "success" | "neutral" | "warning" | "danger" } {
  if (!p.isActive) return { label: "Off", tone: "neutral" };
  if (p.remaining === 0) return { label: "Used up", tone: "danger" };
  if (now !== null && p.validUntil && new Date(p.validUntil).getTime() <= now) return { label: "Expired", tone: "neutral" };
  if (now !== null && p.validFrom && new Date(p.validFrom).getTime() > now) return { label: "Scheduled", tone: "warning" };
  return { label: "Active", tone: "success" };
}

export function PromoCodesPage() {
  const event = useManagedEvent();
  const now = useNow();
  const promos = usePromoCodes(event.id);
  const toggle = useTogglePromo(event.id);
  const del = useDeletePromo(event.id);
  const [editing, setEditing] = useState<PromoCode | "new" | null>(null);
  const [deleting, setDeleting] = useState<PromoCode | null>(null);
  const readOnly = isReadOnly(event);
  const list = promos.data ?? [];

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-xl text-[14.5px] leading-relaxed text-muted">
          Buyers type a code at checkout for a discount. Codes are case-insensitive. Organizer-wide codes (made elsewhere) also work here and are marked.
        </p>
        {!readOnly && list.length > 0 && (
          <Button className="h-10" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> New code
          </Button>
        )}
      </div>

      {promos.isPending ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : promos.isError ? (
        <EmptyState title="We couldn't load promo codes" description={errorMessage(promos.error)} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Tags className="size-5" />}
          title="No promo codes yet"
          description="Reward early buyers, partners or a guest list: a percentage or a fixed amount off, with optional limits and dates."
          action={!readOnly && <Button onClick={() => setEditing("new")}>Create a code</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[640px] text-left text-[14px]">
            <thead className="border-b border-line text-[12px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Discount</th>
                <th className="px-5 py-3 font-medium">Used</th>
                <th className="px-5 py-3 font-medium">Valid</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="w-12 px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((p) => {
                const s = promoState(p, now);
                return (
                  <tr key={p.id} className={cn(!p.isActive && "text-muted")}>
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-[13.5px] font-semibold tracking-wide">{p.code}</span>
                      {p.eventId === null && <span className="ml-2 text-[12px] text-muted">all events</span>}
                    </td>
                    <td className="px-5 py-3.5">{discountLabel(p)}</td>
                    <td className="px-5 py-3.5">
                      {p.timesRedeemed.toLocaleString()}
                      {p.maxRedemptions !== null && <span className="text-muted"> / {p.maxRedemptions.toLocaleString()}</span>}
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-muted">{validLabel(p, event.timezone)}</td>
                    <td className="px-5 py-3.5">
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {!readOnly && (
                        <Menu
                          trigger={(props) => (
                            <button {...props} type="button" aria-label={`Actions for ${p.code}`} className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-ink/5 hover:text-ink">
                              <MoreHorizontal className="size-4" />
                            </button>
                          )}
                        >
                          <MenuButton icon={<Pencil className="size-4" />} onSelect={() => setEditing(p)}>
                            Edit
                          </MenuButton>
                          <MenuButton
                            icon={<Power className="size-4" />}
                            onSelect={() =>
                              toggle.mutate(
                                { promoId: p.id, isActive: !p.isActive },
                                {
                                  onSuccess: () => toast.success(p.isActive ? `${p.code} turned off` : `${p.code} turned on`),
                                  onError: (err) => toast.error(errorMessage(err)),
                                },
                              )
                            }
                          >
                            {p.isActive ? "Turn off" : "Turn on"}
                          </MenuButton>
                          {p.timesRedeemed === 0 && (
                            <MenuButton icon={<Trash2 className="size-4" />} onSelect={() => setDeleting(p)} danger>
                              Delete
                            </MenuButton>
                          )}
                        </Menu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <PromoDialog event={event} promo={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.code ?? "code"}?`}
        description="Only codes nobody has used can be deleted. To stop a used code, turn it off instead."
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(`${deleting.code} deleted`);
              setDeleting(null);
            },
            onError: (err) => {
              setDeleting(null);
              toast.error(errorMessage(err));
            },
          })
        }
      />
    </>
  );
}

function validLabel(p: PromoCode, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-NP", { month: "short", day: "numeric", timeZone });
  if (p.validFrom && p.validUntil) return `${f.format(new Date(p.validFrom))} – ${f.format(new Date(p.validUntil))}`;
  if (p.validFrom) return `from ${f.format(new Date(p.validFrom))}`;
  if (p.validUntil) return `until ${f.format(new Date(p.validUntil))}`;
  return "Any time";
}

const valuesFrom = (p: PromoCode | null, tz: string): PromoValues => ({
  code: p?.code ?? "",
  discountType: p?.discountType ?? "percent",
  discountValue: p ? (p.discountType === "percent" ? String(p.discountValue) : paisaToInput(p.discountValue)) : "",
  maxRedemptions: p?.maxRedemptions ? String(p.maxRedemptions) : "",
  validFrom: toLocalInput(p?.validFrom, tz),
  validUntil: toLocalInput(p?.validUntil, tz),
  isActive: p?.isActive ?? true,
});

function PromoDialog({ event, promo, onClose }: { event: ManageEvent; promo: PromoCode | null; onClose: () => void }) {
  const tz = event.timezone;
  const save = useSavePromo(event.id);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<PromoValues>({ resolver: zodResolver(promoSchema), defaultValues: valuesFrom(promo, tz) });
  const [type, value] = useWatch({ control, name: ["discountType", "discountValue"] });
  const fixed = type === "fixed" ? toPaisa(value ?? "") : null;

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const edit = !!promo;
    const body: PromoInput = {
      code: v.code,
      discountType: v.discountType,
      discountValue: v.discountType === "percent" ? Number(v.discountValue) : toPaisa(v.discountValue)!,
      maxRedemptions: v.maxRedemptions ? Number(v.maxRedemptions) : edit ? null : undefined,
      validFrom: v.validFrom ? fromLocalInput(v.validFrom, tz) : edit ? null : undefined,
      validUntil: v.validUntil ? fromLocalInput(v.validUntil, tz) : edit ? null : undefined,
      isActive: v.isActive,
    };
    try {
      await save.mutateAsync({ promoId: promo?.id, body });
      toast.success(promo ? `${v.code} updated` : `${v.code} created`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "PROMO_CODE_EXISTS") {
        setError("code", { type: "server", message: "You already have a code with this name." }, { shouldFocus: true });
        return;
      }
      setFormError(applyServerErrors(err, setError, FIELDS));
    }
  });

  return (
    <Dialog open onClose={onClose} title={promo ? `Edit ${promo.code}` : "New promo code"} className="max-w-lg">
      <form onSubmit={onSubmit} noValidate className="max-h-[70dvh] space-y-4 overflow-y-auto px-0.5 pb-0.5">
        <FormAlert message={formError} />
        <Field
          label="Code"
          placeholder="EARLY20"
          autoCapitalize="characters"
          readOnly={!!promo}
          className={cn("font-mono uppercase tracking-wide", promo && "bg-ink/[0.03] text-muted")}
          error={errors.code?.message}
          hint={<p className="text-[12.5px] text-muted">{promo ? "The code itself can't change." : "Letters, digits, _ or -. Not case-sensitive."}</p>}
          {...register("code")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Discount type"
            options={[
              { value: "percent", label: "Percentage" },
              { value: "fixed", label: "Fixed amount (NPR)" },
            ]}
            {...register("discountType")}
          />
          <Field
            label={type === "percent" ? "Percent off" : "Amount off (NPR)"}
            inputMode={type === "percent" ? "numeric" : "decimal"}
            placeholder={type === "percent" ? "20" : "500"}
            error={errors.discountValue?.message}
            hint={
              <p className="text-[12.5px] text-muted">
                {type === "percent" ? (value === "100" ? "Free tickets: bookings confirm instantly." : "Per order, rounded down.") : fixed ? `${formatMoney(fixed)} off each order` : "Off each order"}
              </p>
            }
            {...register("discountValue")}
          />
          <Field
            label="Max uses"
            inputMode="numeric"
            placeholder="No limit"
            labelAside={<span className="text-[12px] text-muted">Optional</span>}
            error={errors.maxRedemptions?.message}
            hint={promo && promo.timesRedeemed > 0 ? <p className="text-[12.5px] text-muted">Used {promo.timesRedeemed} times so far</p> : undefined}
            {...register("maxRedemptions")}
          />
          <div className="hidden sm:block" />
          <Field label="Valid from" type="datetime-local" labelAside={<span className="text-[12px] text-muted">Optional</span>} error={errors.validFrom?.message} {...register("validFrom")} />
          <Field label="Valid until" type="datetime-local" labelAside={<span className="text-[12px] text-muted">Optional</span>} error={errors.validUntil?.message} {...register("validUntil")} />
        </div>
        <p className="text-[12.5px] text-muted">Times are in {tz.replace(/_/g, " ")}.</p>
        <label className="flex items-center gap-2.5 text-[14px]">
          <input type="checkbox" className="size-4 accent-ink" {...register("isActive")} />
          Active
        </label>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {promo ? "Save changes" : "Create code"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
