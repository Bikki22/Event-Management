import { AccountShell } from "@/components/account/account-shell";

// Gated on the in-memory session, which only exists in the browser: children render client-side,
// so Next can't validate them for instant navigation (see docs: guides/instant-navigation#opting-out).
export const instant = false;

// Its own full page: no site navbar, search or footer (see AccountShell).
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
