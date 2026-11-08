import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPayments } from "@/components/admin/payments";
import { PageLoader } from "@/components/ui/primitives";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Payments", robots: { index: false } };

// filters live in the URL (useSearchParams needs a Suspense boundary)
export default function Page() {
  return (
    <Suspense fallback={<PageLoader />}>
      <AdminPayments />
    </Suspense>
  );
}
