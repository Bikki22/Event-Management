import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/components/auth/guards";
import { PaymentReturn } from "@/components/checkout/payment-return";
import { PageLoader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Confirming payment", robots: { index: false } };

// Payment gateways redirect here (server PAYMENT_RETURN_URL). Verify needs the signed-in session.
export const instant = false;

export default function Page() {
  return (
    // the gateway's reference is in the query string (useSearchParams), so this needs Suspense
    <Suspense fallback={<PageLoader />}>
      <RequireAuth>
        <PaymentReturn />
      </RequireAuth>
    </Suspense>
  );
}
