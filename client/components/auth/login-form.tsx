"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { AuthHeader, stagger } from "@/components/auth/auth-header";
import { useRedirectIfAuthenticated } from "@/components/auth/guest-only";
import { Button } from "@/components/ui/button";
import { Field, PasswordField } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useLogin } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api/client";
import { applyServerErrors } from "@/lib/form-errors";
import { loginSchema, type LoginValues } from "@/lib/validation/auth";

export function LoginForm() {
  const next = useRedirectIfAuthenticated();
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    login.mutate(values, {
      onSuccess: ({ user }) => {
        toast.success(`Welcome back, ${user.fullName.split(" ")[0]}`);
        // the redirect itself happens in useRedirectIfAuthenticated
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") {
          setFormError("That email and password don't match. Try again or reset your password.");
        } else if (err instanceof ApiError && err.code === "ACCOUNT_SUSPENDED") {
          setFormError("This account has been suspended. Contact support if you think this is a mistake.");
        } else {
          setFormError(applyServerErrors(err, setError, ["email", "password"]));
        }
      },
    });
  });

  const registerHref = next === "/" ? "/register" : `/register?next=${encodeURIComponent(next)}`;

  return (
    <>
      <AuthHeader title="Welcome back" subtitle="Sign in to see your tickets and bookings." />

      <motion.form
        noValidate
        onSubmit={onSubmit}
        variants={stagger.container}
        initial="hidden"
        animate="show"
        className="space-y-5"
      >
        <FormAlert message={formError} />

        <motion.div variants={stagger.item}>
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            autoFocus
            error={errors.email?.message}
            {...register("email")}
          />
        </motion.div>

        <motion.div variants={stagger.item}>
          <PasswordField
            label="Password"
            autoComplete="current-password"
            error={errors.password?.message}
            labelAside={
              <Link href="/forgot-password" className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">
                Forgot?
              </Link>
            }
            {...register("password")}
          />
        </motion.div>

        <motion.div variants={stagger.item} className="pt-1">
          <Button type="submit" loading={login.isPending} className="group w-full">
            {login.isPending ? "Signing in…" : "Sign in"}
            {!login.isPending && <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />}
          </Button>
        </motion.div>
      </motion.form>

      <p className="mt-8 border-t border-line pt-6 text-[14px] text-muted">
        New here?{" "}
        <Link href={registerHref} className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-4">
          Create an account
        </Link>
      </p>
    </>
  );
}
