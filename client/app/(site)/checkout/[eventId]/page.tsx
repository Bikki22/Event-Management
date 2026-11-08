import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/components/auth/guards";
import { CheckoutView } from "@/components/checkout/checkout-view";
import { PageLoader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

// Signed-in only and driven by the browser session + sessionStorage, so it renders client-side.
export const instant = false;

export default function Page() {
  return (
    // useParams/usePathname read the URL, which is runtime data on a dynamic route
    <Suspense fallback={<PageLoader />}>
      <RequireAuth>
        <CheckoutView />
      </RequireAuth>
    </Suspense>
  );
}
