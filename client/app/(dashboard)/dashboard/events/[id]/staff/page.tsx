import type { Metadata } from "next";
import { StaffPage } from "@/components/organizer/staff";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Door staff", robots: { index: false } };

// the event comes from the layout's <EventManageShell>
export default function Page() {
  return <StaffPage />;
}
