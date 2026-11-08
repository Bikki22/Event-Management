import type { Metadata } from "next";
import { AdminAuditLog } from "@/components/admin/audit-log";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Audit log", robots: { index: false } };

export default function Page() {
  return <AdminAuditLog />;
}
