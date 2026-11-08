import type { Metadata } from "next";
import { OrganizerProfilePage } from "@/components/organizer/profile-page";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Organizer profile", robots: { index: false } };

export default function Page() {
  return <OrganizerProfilePage />;
}
