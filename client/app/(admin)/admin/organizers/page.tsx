import type { Metadata } from "next";
import { AdminOrganizers } from "@/components/admin/organizers";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Organizers", robots: { index: false } };

export default function Page() {
  return <AdminOrganizers />;
}
