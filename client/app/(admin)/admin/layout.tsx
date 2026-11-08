import { AdminShell } from "@/components/dashboard/shells";

// Gated on the in-memory session (client-side), so Next can't validate it for instant navigation.
export const instant = false;

// Its own full page (sidebar app layout), not under the site navbar.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
