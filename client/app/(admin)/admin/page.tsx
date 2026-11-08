import type { Metadata } from "next";
import { AdminOverview } from "@/components/admin/overview";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default function Page() {
  return <AdminOverview />;
}
