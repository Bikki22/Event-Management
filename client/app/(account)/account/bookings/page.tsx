import type { Metadata } from "next";
import { BookingsList } from "@/components/account/bookings-list";

// rendered client-side behind <RequireAuth> (see account/layout.tsx)
export const instant = false;

export const metadata: Metadata = { title: "My bookings" };

export default function Page() {
  return <BookingsList />;
}
