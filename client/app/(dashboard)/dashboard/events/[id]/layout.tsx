import { Suspense } from "react";
import { EventManageShell } from "@/components/organizer/event-manage-shell";
import { PageLoader } from "@/components/ui/primitives";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

/** Header + tabs (Event, Promo codes, Attendees, Door staff) shared by one event's pages. */
export default function Layout({ params, children }: LayoutProps<"/dashboard/events/[id]">) {
  return (
    <Suspense fallback={<PageLoader />}>
      {params.then(({ id }) => (
        <EventManageShell id={id}>{children}</EventManageShell>
      ))}
    </Suspense>
  );
}
