import type { Metadata } from "next";
import { Suspense } from "react";
import { EventEditorPage } from "@/components/organizer/event-editor/editor-page";
import { PageLoader } from "@/components/ui/primitives";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Edit event", robots: { index: false } };

// the event itself comes from the layout's <EventManageShell>; the step is in ?step= (needs Suspense)
export default function Page() {
  return (
    <Suspense fallback={<PageLoader />}>
      <EventEditorPage />
    </Suspense>
  );
}
