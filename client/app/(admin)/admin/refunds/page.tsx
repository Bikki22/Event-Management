import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminRefunds } from "@/components/admin/refunds";
import { PageLoader } from "@/components/ui/primitives";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Refunds", robots: { index: false } };

// filters live in the URL (useSearchParams needs a Suspense boundary)
export default function Page() {
  return (
    <Suspense fallback={<PageLoader />}>
      <AdminRefunds />
    </Suspense>
  );
}
