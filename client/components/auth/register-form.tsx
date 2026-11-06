"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { AuthHeader, stagger } from "@/components/auth/auth-header";
import { useRedirectIfAuthenticated } from "@/components/auth/guest-only";
import { PasswordStrength } from "@/components/auth/password-strength";
import { Button } from "@/components/ui/button";
import { Field, PasswordField } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useRegister } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api/client";
import { applyServerErrors } from "@/lib/form-errors";
import { registerSchema, type RegisterValues } from "@/lib/validation/auth";

const FIELDS = ["fullName", "email", "phone", "password", "confirmPassword"] as const;

export function RegisterForm() {
  const next = useRedirectIfAuthenticated();
  const signUp = useRegister();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", email: "", phone: "", password: "", confirmPassword: "" },
    mode: "onTouched",
  });
  const password = useWatch({ control, name: "password" });

  const onSubmit = handleSubmit(({ fullName, email, phone, password }) => {
    setFormError(null);
    signUp.mutate(
      { fullName, email, password, ...(phone ? { phone } : {}) },
      {
        onSuccess: ({ user }) => {
          toast.success(`You're in, ${user.fullName.split(" ")[0]}`, {
            description: `We sent a verification link to ${user.email}.`,
          });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "EMAIL_TAKEN") {
            setError("email", { type: "server", message: "An account with this email already exists." }, { shouldFocus: true });
          } else {
            setFormError(applyServerErrors(err, setError, FIELDS, { newPassword: "password" }));
          }
        },
      },
    );
  });

  const loginHref = next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;

  return (
    <>
      <AuthHeader title="Create your account" subtitle="Book tickets in a few taps and keep them all in one place." />

      <motion.form
        noValidate
        onSubmit={onSubmit}
        variants={stagger.container}
        initial="hidden"
        animate="show"
        className="space-y-4"
      >
        <FormAlert message={formError} />

        <motion.div variants={stagger.item}>
          <Field
            label="Full name"
            autoComplete="name"
            placeholder="Aarav Sharma"
            autoFocus
            error={errors.fullName?.message}
            {...register("fullName")}
          />
        </motion.div>

        <motion.div variants={stagger.item}>
          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            error={errors.email?.message}
            {...register("email")}
          />
          {errors.email?.type === "server" && (
            <Link href={loginHref} className="mt-1.5 inline-block text-[12.5px] font-medium text-ink underline underline-offset-4">
              Sign in instead
            </Link>
          )}
        </motion.div>

        <motion.div variants={stagger.item}>
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
        </motion.div>

        <motion.div variants={stagger.item}>
          <PasswordField
            label="Password"
            autoComplete="new-password"
            error={errors.password?.message}
            hint={<PasswordStrength password={password} />}
            {...register("password")}
          />
        </motion.div>

        <motion.div variants={stagger.item}>
          <PasswordField
            label="Confirm password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register("confirmPassword")}
          />
        </motion.div>

        <motion.div variants={stagger.item} className="pt-2">
          <Button type="submit" loading={signUp.isPending} className="group w-full">
            {signUp.isPending ? "Creating account…" : "Create account"}
            {!signUp.isPending && <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />}
          </Button>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            By signing up you agree to our Terms and Privacy Policy.
          </p>
        </motion.div>
      </motion.form>

      <p className="mt-8 border-t border-line pt-6 text-[14px] text-muted">
        Already have an account?{" "}
        <Link href={loginHref} className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-4">
          Sign in
        </Link>
      </p>
    </>
  );
}
