import type { Metadata } from "next";
import { SessionsList } from "@/components/account/sessions-list";

// rendered client-side behind <RequireAuth> (see account/layout.tsx)
export const instant = false;

export const metadata: Metadata = { title: "Devices" };

export default function Page() {
  return <SessionsList />;
}
