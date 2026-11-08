"use client";

import {
  BadgeCheck,
  CalendarDays,
  ClipboardList,
  CreditCard,
  LayoutGrid,
  Receipt,
  ScrollText,
  Store,
  Tags,
  Ticket,
  Users,
  Wallet,
} from "lucide-react";
import { AppShell, type ShellNavItem } from "./app-shell";

const organizerNav: ShellNavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/dashboard/events", label: "Events", icon: CalendarDays, soon: true }, // Phase 7
  { href: "/dashboard/promo-codes", label: "Promo codes", icon: Tags, soon: true }, // Phase 7
  { href: "/dashboard/attendees", label: "Attendees", icon: ClipboardList, soon: true }, // Phase 7
  { href: "/dashboard/profile", label: "Organizer profile", icon: Store },
  { href: "/dashboard/payouts", label: "Payouts", icon: Wallet },
];

const adminNav: ShellNavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/admin/organizers", label: "Organizers", icon: BadgeCheck, soon: true }, // Phase 9
  { href: "/admin/users", label: "Users", icon: Users, soon: true },
  { href: "/admin/events", label: "Events", icon: Ticket, soon: true },
  { href: "/admin/categories", label: "Categories", icon: Tags, soon: true },
  { href: "/admin/payments", label: "Payments", icon: CreditCard, soon: true },
  { href: "/admin/refunds", label: "Refunds", icon: Receipt, soon: true },
  { href: "/admin/audit-log", label: "Audit log", icon: ScrollText, soon: true },
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
