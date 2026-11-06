"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { AuthHeader } from "@/components/auth/auth-header";
import { BackToLogin } from "@/components/auth/forgot-form";
import { PasswordStrength } from "@/components/auth/password-strength";
import { Button, LinkButton } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useResetPassword } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api/client";
import { applyServerErrors } from "@/lib/form-errors";
import { resetSchema, type ResetValues } from "@/lib/validation/auth";

export function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const reset = useResetPassword();
  const [formError, setFormError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<ResetValues>({ resolver: zodResolver(resetSchema), defaultValues: { password: "", confirmPassword: "" } });
  const password = useWatch({ control, name: "password" });

  if (!token || expired) {
    return (
      <>
        <AuthHeader
          title="This link has expired"
          subtitle="Reset links work once and only for 30 minutes. Request a new one and we'll email it right away."
        />
        <div className="flex flex-col gap-3">
          <LinkButton href="/forgot-password" className="w-full">
            Request a new link
          </LinkButton>
          <BackToLogin />
        </div>
      </>
    );
  }

  const onSubmit = handleSubmit(({ password }) => {
    setFormError(null);
    reset.mutate(
      { token, password },
      {
        onSuccess: () => {
          toast.success("Password updated", { description: "Sign in with your new password." });
          router.replace("/login");
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "INVALID_OR_EXPIRED_TOKEN") setExpired(true);
          else setFormError(applyServerErrors(err, setError, ["password"], { newPassword: "password" }));
        },
      },
    );
  });

  return (
    <>
      <AuthHeader
        title="Set a new password"
        subtitle="Choose something you haven't used here before. You'll be signed out on all devices."
      />
      <form noValidate onSubmit={onSubmit} className="space-y-5">
        <FormAlert message={formError} />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          autoFocus
          error={errors.password?.message}
          hint={<PasswordStrength password={password} />}
          {...register("password")}
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />
        <Button type="submit" loading={reset.isPending} className="w-full">
          Update password
        </Button>
        <BackToLogin />
      </form>
    </>
  );
}
