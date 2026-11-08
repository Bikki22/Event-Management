import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingDetail } from "@/components/account/booking-detail";
import { PageLoader } from "@/components/ui/primitives";

// rendered client-side behind <RequireAuth> (see account/layout.tsx)
export const instant = false;

export const metadata: Metadata = { title: "Booking", robots: { index: false } };

export default function Page({ params }: PageProps<"/account/bookings/[id]">) {
  return (
    <Suspense fallback={<PageLoader />}>
      {params.then(({ id }) => (
        <BookingDetail id={id} />
      ))}
    </Suspense>
  );
}
