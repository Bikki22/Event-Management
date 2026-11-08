"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Badge, Section } from "@/components/ui/primitives";
import { useUpdateProfile } from "@/hooks/use-account";
import { useAuth } from "@/hooks/use-auth";
import { formatDate } from "@/lib/format";
import { applyServerErrors } from "@/lib/form-errors";
import type { User } from "@/lib/api/types";
import { profileSchema, type ProfileValues } from "@/lib/validation/auth";

export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* key: re-initialise the form if the user object changes elsewhere (e.g. another tab) */}
      <ProfileForm key={user.id} user={user} />
      <AccountFacts user={user} />
    </div>
  );
}

function ProfileForm({ user }: { user: User }) {
  const update = useUpdateProfile();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: user.fullName, phone: user.phone ?? "" },
  });

  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    update.mutate(
      { fullName: v.fullName, phone: v.phone === "" ? null : v.phone },
      {
        onSuccess: ({ user }) => {
          reset({ fullName: user.fullName, phone: user.phone ?? "" });
          toast.success("Profile saved");
        },
        onError: (err) => setFormError(applyServerErrors(err, setError, ["fullName", "phone"])),
      },
    );
  });

  return (
    <form noValidate onSubmit={onSubmit}>
      <Section
        title="Personal details"
        description="This is how organizers and door staff see you on tickets."
        footer={
          <>
            {isDirty && (
              <Button type="button" variant="ghost" className="h-10" onClick={() => reset()}>
                Discard
              </Button>
            )}
            <Button type="submit" className="h-10" loading={update.isPending} disabled={!isDirty}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <FormAlert message={formError} />
          <Field label="Full name" autoComplete="name" error={errors.fullName?.message} {...register("fullName")} />
          <Field
            label="Email"
            value={user.email}
            readOnly
            disabled
            className="cursor-not-allowed bg-paper text-muted"
            labelAside={
              user.emailVerified ? (
                <Badge tone="success" dot>
                  Verified
                </Badge>
              ) : (
                <Badge tone="warning" dot>
                  Not verified
                </Badge>
              )
            }
            hint={<p className="text-[12.5px] text-muted">Changing your email isn&apos;t supported yet.</p>}
          />
          <Field
            label="Phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98XXXXXXXX"
            labelAside={<span className="text-[12px] text-muted">Optional</span>}
            error={errors.phone?.message}
            {...register("phone")}
          />
        </div>
      </Section>
    </form>
  );
}

function AccountFacts({ user }: { user: User }) {
  const rows: [string, React.ReactNode][] = [
    ["Account type", <span key="r" className="capitalize">{user.role}</span>],
    ["Member since", formatDate(user.createdAt)],
    ["Email", user.emailVerified ? "Verified" : "Waiting for verification"],
  ];
  return (
    <aside>
      <Section title="Account">
        <dl className="-my-3 divide-y divide-line text-[14px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-3">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </aside>
  );
}
