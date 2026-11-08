import type { Metadata } from "next";
import { PromoCodesPage } from "@/components/organizer/promo-codes";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Promo codes", robots: { index: false } };

// the event comes from the layout's <EventManageShell>
export default function Page() {
  return <PromoCodesPage />;
}
