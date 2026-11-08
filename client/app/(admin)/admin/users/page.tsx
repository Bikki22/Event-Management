import type { Metadata } from "next";
import { AdminUsers } from "@/components/admin/users";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Users", robots: { index: false } };

export default function Page() {
  return <AdminUsers />;
}
