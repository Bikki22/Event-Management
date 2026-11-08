import type { Metadata } from "next";
import { OrganizerOverview } from "@/components/organizer/overview";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Organizer dashboard", robots: { index: false } };

export default function Page() {
  return <OrganizerOverview />;
}
