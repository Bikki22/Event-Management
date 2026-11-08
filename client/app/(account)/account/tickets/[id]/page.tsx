import type { Metadata } from "next";
import { Suspense } from "react";
import { TicketDetail } from "@/components/account/ticket-detail";
import { PageLoader } from "@/components/ui/primitives";

// rendered client-side behind <RequireAuth> (see account/layout.tsx)
export const instant = false;

export const metadata: Metadata = { title: "Ticket", robots: { index: false } };

export default function Page({ params }: PageProps<"/account/tickets/[id]">) {
  return (
    <Suspense fallback={<PageLoader />}>
      {params.then(({ id }) => (
        <TicketDetail id={id} />
      ))}
    </Suspense>
  );
}
