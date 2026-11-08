import type { Metadata } from "next";
import { PayoutsPage } from "@/components/organizer/payouts-page";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Payouts", robots: { index: false } };

export default function Page() {
  return <PayoutsPage />;
}
