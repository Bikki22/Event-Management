"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ScanLine, UserMinus } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/inputs";
import { Avatar, Badge, EmptyState, Section, Skeleton } from "@/components/ui/primitives";
import { useAddStaff, useRemoveStaff, useStaff } from "@/hooks/use-manage";
import { ApiError, errorMessage } from "@/lib/api/client";
import { isReadOnly, type StaffMember, type StaffRole } from "@/lib/api/manage";
import { applyServerErrors } from "@/lib/form-errors";
import { formatRelative } from "@/lib/format";
import { staffSchema, type StaffValues } from "@/lib/validation/event";
import { useManagedEvent } from "./event-manage-shell";

const ROLES: Record<StaffRole, { label: string; hint: string }> = {
  scanner: { label: "Scanner", hint: "Scans tickets at the door. Can't see the attendee list." },
  manager: { label: "Manager", hint: "Scans tickets and can view and export the attendee list." },
};

export function StaffPage() {
  const event = useManagedEvent();
  const staff = useStaff(event.id);
  const remove = useRemoveStaff(event.id);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const readOnly = isReadOnly(event);
  const list = staff.data ?? [];

  return (
    <div className="space-y-6">
      {!readOnly && <AddStaffForm eventId={event.id} />}

      <Section title="Team for this event" description="You can always scan tickets yourself; you don't need to add yourself.">
        {staff.isPending ? (
          <Skeleton className="h-24" />
        ) : staff.isError ? (
          <p className="text-[14px] text-red-600">{errorMessage(staff.error)}</p>
        ) : list.length === 0 ? (
          <EmptyState icon={<ScanLine className="size-5" />} title="No door staff yet" description="Add the people who'll scan tickets at the entrance." />
        ) : (
          <ul className="-my-2 divide-y divide-line">
            {list.map((s) => (
              <li key={s.userId} className="flex items-center gap-3 py-3">
                <Avatar name={s.fullName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium">{s.fullName}</p>
                  <p className="truncate text-[13px] text-muted">
                    {s.email} · added {formatRelative(s.addedAt)}
                  </p>
                </div>
                <Badge tone={s.role === "manager" ? "dark" : "neutral"}>{ROLES[s.role].label}</Badge>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setRemoving(s)}
                    aria-label={`Remove ${s.fullName}`}
                    title="Remove"
                    className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-red-50 hover:text-red-600"
                  >
                    <UserMinus className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.fullName ?? "this person"}?`}
        description="They won't be able to scan tickets for this event anymore."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.userId, {
            onSuccess: () => {
              toast.success(`${removing.fullName} removed`);
              setRemoving(null);
            },
            onError: (err) => {
              setRemoving(null);
              toast.error(errorMessage(err));
            },
          })
        }
      />
    </div>
  );
}

function AddStaffForm({ eventId }: { eventId: string }) {
  const add = useAddStaff(eventId);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors },
  } = useForm<StaffValues>({ resolver: zodResolver(staffSchema), defaultValues: { email: "", role: "scanner" } });
  const role = useWatch({ control, name: "role" });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const { staff } = await add.mutateAsync(v);
      toast.success(`${staff.fullName} added as ${ROLES[staff.role].label.toLowerCase()}`);
      reset({ email: "", role: v.role });
    } catch (err) {
      if (err instanceof ApiError && (err.code === "USER_NOT_FOUND" || err.code === "ALREADY_ORGANIZER")) {
        setError("email", { type: "server", message: err.code === "USER_NOT_FOUND" ? "No account with this email. Ask them to sign up first." : "That's you: organizers can already scan." }, { shouldFocus: true });
        return;
      }
      setFormError(applyServerErrors(err, setError, ["email", "role"]));
    }
  });

  return (
    <Section title="Add door staff" description="They need a Book Event account. Adding someone again changes their role.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormAlert message={formError} />
        <div className="grid gap-4 sm:grid-cols-[1fr_200px_auto] sm:items-start">
          <Field label="Email" type="email" placeholder="volunteer@example.com" autoComplete="off" error={errors.email?.message} {...register("email")} />
          <Select
            label="Role"
            options={Object.entries(ROLES).map(([value, r]) => ({ value, label: r.label }))}
            {...register("role")}
          />
          <Button type="submit" loading={add.isPending} className="sm:mt-[26px]">
            Add
          </Button>
        </div>
        <p className="text-[12.5px] text-muted">{ROLES[role].hint}</p>
      </form>
    </Section>
  );
}
