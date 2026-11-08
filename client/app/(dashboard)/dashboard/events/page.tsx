import type { Metadata } from "next";
import { EventsList } from "@/components/organizer/events-list";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Events", robots: { index: false } };

export default function Page() {
  return <EventsList />;
}
