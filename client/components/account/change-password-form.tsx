"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { PasswordStrength } from "@/components/auth/password-strength";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Section } from "@/components/ui/primitives";
import { useChangePassword } from "@/hooks/use-account";
import { ApiError } from "@/lib/api/client";
import { applyServerErrors } from "@/lib/form-errors";
import { changePasswordSchema, type ChangePasswordValues } from "@/lib/validation/auth";

export function ChangePasswordForm() {
  const change = useChangePassword();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    formState: { errors },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const newPassword = useWatch({ control, name: "newPassword" });

  const onSubmit = handleSubmit(({ currentPassword, newPassword }) => {
    setFormError(null);
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          reset();
          toast.success("Password changed", { description: "Your other devices have been signed out." });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") {
            setError("currentPassword", { type: "server", message: "That's not your current password" }, { shouldFocus: true });
          } else {
            setFormError(applyServerErrors(err, setError, ["currentPassword", "newPassword"]));
          }
        },
      },
    );
  });

  return (
    <form noValidate onSubmit={onSubmit} className="max-w-2xl">
      <Section
        title="Change password"
        description="You'll stay signed in here. Every other device will be signed out."
        footer={
          <Button type="submit" className="h-10" loading={change.isPending}>
            Update password
          </Button>
        }
      >
        <div className="space-y-5">
          <FormAlert message={formError} />
          {/* hidden username helps password managers save the right entry */}
          <input type="text" name="username" autoComplete="username" hidden readOnly />
          <PasswordField
            label="Current password"
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register("currentPassword")}
          />
          <PasswordField
            label="New password"
            autoComplete="new-password"
            error={errors.newPassword?.message}
            hint={<PasswordStrength password={newPassword} />}
            {...register("newPassword")}
          />
          <PasswordField
            label="Confirm new password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register("confirmPassword")}
          />
        </div>
      </Section>
    </form>
  );
}
