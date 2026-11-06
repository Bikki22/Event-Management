import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotForm } from "@/components/auth/forgot-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function Page() {
  return (
    // the form reads search params, which must sit behind a Suspense boundary
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}
