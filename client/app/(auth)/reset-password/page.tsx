import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetForm } from "@/components/auth/reset-form";

export const metadata: Metadata = { title: "Reset password" };

export default function Page() {
  return (
    // the form reads search params, which must sit behind a Suspense boundary
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
