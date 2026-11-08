import { Construction } from "lucide-react";
import type { Metadata } from "next";
import { DashHeader } from "@/components/dashboard/app-shell";
import { EmptyState } from "@/components/ui/primitives";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

// Phase 9 builds the real admin pages (stats, organizers, users, categories, payments, audit log).
export default function Page() {
  return (
    <>
      <DashHeader eyebrow="Admin" title="Admin" description="Platform stats, organizer verification, users, categories, payments and the audit log." />
      <EmptyState
        icon={<Construction className="size-5" />}
        title="Coming in Phase 9"
        description="Until then, use the admin API from Postman (see admin.md), e.g. to verify organizers."
      />
    </>
  );
}
