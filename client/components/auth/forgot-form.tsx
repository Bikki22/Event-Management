"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AuthHeader } from "@/components/auth/auth-header";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForgotPassword } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/api/client";
import { forgotSchema, type ForgotValues } from "@/lib/validation/auth";

export function ForgotForm() {
  const forgot = useForgotPassword();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotValues>({ resolver: zodResolver(forgotSchema), defaultValues: { email: "" } });

  const onSubmit = handleSubmit(({ email }) => forgot.mutate(email, { onSuccess: () => setSentTo(email) }));

  return (
    <AnimatePresence mode="wait">
      {sentTo ? (
        <motion.div key="sent" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <AuthHeader
            title="Check your inbox"
            subtitle={
              <>
                If an account exists for <span className="font-medium text-ink">{sentTo}</span>, a reset link is on its
                way. It expires in 30 minutes.
              </>
            }
          />
          <div className="flex flex-col gap-4">
            <Button variant="secondary" onClick={() => setSentTo(null)}>
              Use a different email
            </Button>
            <BackToLogin />
          </div>
        </motion.div>
      ) : (
        <motion.div key="form" exit={{ opacity: 0, y: -6 }}>
          <AuthHeader title="Reset your password" subtitle="Enter the email you signed up with and we'll send you a link." />
          <form noValidate onSubmit={onSubmit} className="space-y-5">
            <FormAlert message={forgot.isError ? errorMessage(forgot.error) : null} />
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              autoFocus
              error={errors.email?.message}
              {...register("email")}
            />
            <Button type="submit" loading={forgot.isPending} className="w-full">
              Send reset link
            </Button>
            <BackToLogin />
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function BackToLogin() {
  return (
    <Link href="/login" className="flex items-center justify-center gap-1.5 text-[14px] text-muted transition hover:text-ink">
      <ArrowLeft className="size-4" /> Back to sign in
    </Link>
  );
}
