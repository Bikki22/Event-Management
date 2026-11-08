import type { Metadata } from "next";
import { TicketsList } from "@/components/account/tickets-list";

// rendered client-side behind <RequireAuth> (see account/layout.tsx)
export const instant = false;

export const metadata: Metadata = { title: "My tickets" };

export default function Page() {
  return <TicketsList />;
}
