"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Landmark, Lock, Wallet } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { DashHeader } from "@/components/dashboard/app-shell";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { EmptyState, PageLoader, Section } from "@/components/ui/primitives";
import { useOrganizerProfile, useRemovePayout, useSetPayout } from "@/hooks/use-organizer";
import { errorMessage } from "@/lib/api/client";
import type { MaskedPayout, PayoutInput } from "@/lib/api/organizer";
import { applyServerErrors } from "@/lib/form-errors";
import { cn } from "@/lib/utils";
import { payoutSchema, type PayoutValues } from "@/lib/validation/organizer";

const METHODS = [
  { value: "esewa", label: "eSewa", icon: Wallet },
  { value: "khalti", label: "Khalti", icon: Wallet },
  { value: "bank", label: "Bank account", icon: Landmark },
] as const;

export function PayoutsPage() {
  const profile = useOrganizerProfile();
  const remove = useRemovePayout();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (profile.isPending) return <PageLoader />;
  if (!profile.data)
    return <EmptyState title="No organizer profile yet" action={<LinkButton href="/organizer/apply">Create organizer profile</LinkButton>} />;

  const payout = profile.data.payout;
  return (
    <>
      <DashHeader eyebrow="Organizer" title="Payouts" description="Where we send the money from your ticket sales." />
      <div className="max-w-2xl space-y-6">
        {payout && !editing ? (
          <Section
            title="Payout account"
            footer={
              <>
                <Button variant="ghost" className="h-10" onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
                <Button variant="secondary" className="h-10" onClick={() => setEditing(true)}>
                  Change account
                </Button>
              </>
            }
          >
            <PayoutSummary payout={payout} />
          </Section>
        ) : (
          <Section
            title={payout ? "Change payout account" : "Add a payout account"}
            description="Ticket money is paid out to this account after your events."
          >
            <PayoutForm onDone={() => setEditing(false)} onCancel={payout ? () => setEditing(false) : undefined} />
          </Section>
        )}
        <p className="flex items-start gap-2 text-[13px] text-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          Account details are encrypted. After saving, only the last digits are shown, even to you.
        </p>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Remove payout account?"
        description="We can't pay you out until you add a new one."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              setConfirmRemove(false);
              toast("Payout account removed");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}

function PayoutSummary({ payout }: { payout: MaskedPayout }) {
  const rows: [string, string][] =
    payout.method === "bank"
      ? [
          ["Method", "Bank account"],
          ["Bank", payout.branch ? `${payout.bankName}, ${payout.branch}` : payout.bankName],
          ["Account name", payout.accountName],
          ["Account number", payout.accountNumber],
        ]
      : [
          ["Method", payout.method === "esewa" ? "eSewa" : "Khalti"],
          ["Account name", payout.accountName],
          ["Wallet", payout.walletId],
        ];
  return (
    <dl className="-my-3 divide-y divide-line text-[14.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 py-3">
          <dt className="text-muted">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function PayoutForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const save = useSetPayout();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<PayoutValues>({
    resolver: zodResolver(payoutSchema),
    defaultValues: { method: "esewa", walletId: "", accountName: "" } as PayoutValues,
  });
  const method = useWatch({ control, name: "method" });
  const err = errors as Partial<Record<string, { message?: string }>>;

  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    const body: PayoutInput =
      v.method === "bank"
        ? { method: "bank", bankName: v.bankName, accountName: v.accountName, accountNumber: v.accountNumber, ...(v.branch ? { branch: v.branch } : {}) }
        : { method: v.method, walletId: v.walletId, accountName: v.accountName };
    save.mutate(body, {
      onSuccess: () => {
        toast.success("Payout account saved");
        onDone();
      },
      onError: (e) => setFormError(applyServerErrors(e, setError, ["walletId", "accountName", "bankName", "branch", "accountNumber"] as never)),
    });
  });

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-5">
      <FormAlert message={formError} />
      <div role="radiogroup" aria-label="Payout method" className="grid gap-2 sm:grid-cols-3">
        {METHODS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={method === value}
            onClick={() => {
              setValue("method", value);
              clearErrors();
            }}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border px-4 py-3 text-[14.5px] transition",
              method === value ? "border-ink shadow-[0_0_0_1px_var(--ink)]" : "border-line hover:border-ink/30",
            )}
          >
            <Icon className={cn("size-4", method === value ? "text-accent" : "text-muted")} />
            {label}
          </button>
        ))}
      </div>

      {method === "bank" ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Bank" placeholder="Nabil Bank" error={err.bankName?.message} {...register("bankName")} />
          <Field label="Branch" placeholder="Durbar Marg" labelAside={<span className="text-[12px] text-muted">Optional</span>} error={err.branch?.message} {...register("branch")} />
          <Field label="Account holder" placeholder="As on the account" error={err.accountName?.message} {...register("accountName")} />
          <Field label="Account number" inputMode="numeric" autoComplete="off" error={err.accountNumber?.message} {...register("accountNumber")} />
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={`${method === "esewa" ? "eSewa" : "Khalti"} ID (mobile number)`}
            inputMode="numeric"
            placeholder="98XXXXXXXX"
            autoComplete="off"
            error={err.walletId?.message}
            {...register("walletId")}
          />
          <Field label="Account holder" placeholder="Name on the wallet" error={err.accountName?.message} {...register("accountName")} />
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button type="submit" loading={save.isPending}>
          Save payout account
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
