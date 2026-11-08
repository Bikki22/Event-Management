"use client";

import {
  BadgeCheck,
  CalendarDays,
  CreditCard,
  LayoutGrid,
  Receipt,
  ScrollText,
  Store,
  Tags,
  Users,
  Wallet,
} from "lucide-react";
import { AppShell, type ShellNavItem } from "./app-shell";

const organizerNav: ShellNavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/dashboard/events", label: "Events", icon: CalendarDays },
  { href: "/dashboard/profile", label: "Organizer profile", icon: Store },
  { href: "/dashboard/payouts", label: "Payouts", icon: Wallet },
];

const adminNav: ShellNavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/admin/organizers", label: "Organizers", icon: BadgeCheck },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/categories", label: "Categories", icon: Tags },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/refunds", label: "Refunds", icon: Receipt },
  { href: "/admin/audit-log", label: "Audit log", icon: ScrollText },
];

export function OrganizerShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell area="Organizer" roles={["organizer", "admin"]} nav={organizerNav}>
      {children}
    </AppShell>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell area="Admin" roles={["admin"]} nav={adminNav}>
      {children}
    </AppShell>
  );
}
