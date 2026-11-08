import type { Metadata } from "next";
import { Suspense } from "react";
import { NewEventWizard } from "@/components/organizer/event-editor/wizard";
import { PageLoader } from "@/components/ui/primitives";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "New event", robots: { index: false } };

export default function Page() {
  return (
    <Suspense fallback={<PageLoader />}>
      <NewEventWizard />
    </Suspense>
  );
}
