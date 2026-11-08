"use client";

import { ChevronDown, LayoutDashboard, LogOut, Settings, Shield, Ticket, Receipt } from "lucide-react";
import { Menu, MenuButton, MenuLabel, MenuLink, MenuSeparator } from "@/components/ui/menu";
import { Avatar, Badge } from "@/components/ui/primitives";
import { useLogout } from "@/hooks/use-auth";
import type { User } from "@/lib/api/types";

const icon = "size-4";

export function UserMenu({ user }: { user: User }) {
  const logout = useLogout();
  const isOrganizer = user.role === "organizer" || user.role === "admin";

  return (
    <Menu
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label="Account menu"
          className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 transition hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Avatar name={user.fullName} className="size-8 text-[12px]" />
          <ChevronDown className="size-3.5 text-muted" aria-hidden />
        </button>
      )}
    >
      <MenuLabel>
        <p className="truncate text-[14px] font-medium">{user.fullName}</p>
        <p className="truncate text-[12.5px] text-muted">{user.email}</p>
        {user.role !== "attendee" && (
          <Badge tone={user.role === "admin" ? "dark" : "accent"} className="mt-2 capitalize">
            {user.role}
          </Badge>
        )}
      </MenuLabel>
      <MenuSeparator />
      <MenuLink href="/account/tickets" icon={<Ticket className={icon} />}>
        My tickets
      </MenuLink>
      <MenuLink href="/account/bookings" icon={<Receipt className={icon} />}>
        My bookings
      </MenuLink>
      <MenuLink href="/account" icon={<Settings className={icon} />}>
        Account settings
      </MenuLink>
      {isOrganizer && (
        <>
          <MenuSeparator />
          <MenuLink href="/dashboard" icon={<LayoutDashboard className={icon} />}>
            Organizer dashboard
          </MenuLink>
        </>
      )}
      {user.role === "admin" && (
        <MenuLink href="/admin" icon={<Shield className={icon} />}>
          Admin
        </MenuLink>
      )}
      <MenuSeparator />
      <MenuButton onSelect={() => logout.mutate()} icon={<LogOut className={icon} />}>
        Sign out
      </MenuButton>
    </Menu>
  );
}
