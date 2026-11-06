import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    // the form reads search params, which must sit behind a Suspense boundary
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
