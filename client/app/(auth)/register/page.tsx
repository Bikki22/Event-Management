import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Create account" };

export default function Page() {
  return (
    // the form reads search params, which must sit behind a Suspense boundary
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
