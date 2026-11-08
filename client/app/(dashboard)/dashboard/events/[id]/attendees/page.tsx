import type { Metadata } from "next";
import { AttendeesPage } from "@/components/organizer/attendees";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Attendees", robots: { index: false } };

// the event comes from the layout's <EventManageShell>
export default function Page() {
  return <AttendeesPage />;
}
