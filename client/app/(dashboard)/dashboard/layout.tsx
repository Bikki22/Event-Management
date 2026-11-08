import { OrganizerShell } from "@/components/dashboard/shells";

// Gated on the in-memory session (client-side), so Next can't validate it for instant navigation.
export const instant = false;

// Its own full page (sidebar app layout), not under the site navbar.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <OrganizerShell>{children}</OrganizerShell>;
}
