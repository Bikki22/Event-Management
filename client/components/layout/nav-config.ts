import type { Role } from "@/lib/api/types";

export interface NavItem {
  href: string;
  label: string;
}

export const mainNav: NavItem[] = [
  { href: "/events", label: "Browse events" },
  { href: "/organizer/apply", label: "Host an event" },
];

/** Organizers and admins get a link to their dashboard instead of the "Host an event" pitch. */
export function mainNavFor(role?: Role): NavItem[] {
  if (role === "organizer" || role === "admin") {
    return [{ href: "/events", label: "Browse events" }, { href: "/dashboard", label: "Organizer dashboard" }];
  }
  return mainNav;
}

/** Links in the account menu, filtered by role. */
export function accountNav(role: Role): (NavItem & { group: "you" | "manage" })[] {
  const items: (NavItem & { group: "you" | "manage" })[] = [
    { href: "/account/tickets", label: "My tickets", group: "you" },
    { href: "/account/bookings", label: "My bookings", group: "you" },
    { href: "/account", label: "Account settings", group: "you" },
  ];
  if (role === "organizer" || role === "admin") items.push({ href: "/dashboard", label: "Organizer dashboard", group: "manage" });
  if (role === "admin") items.push({ href: "/admin", label: "Admin", group: "manage" });
  return items;
}
