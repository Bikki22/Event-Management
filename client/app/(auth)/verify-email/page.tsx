import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmail } from "@/components/auth/verify-email";

export const metadata: Metadata = { title: "Verify email" };

export default function Page() {
  return (
    // the form reads search params, which must sit behind a Suspense boundary
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
