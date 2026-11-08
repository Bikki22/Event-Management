"use client";

import { MoreHorizontal, ShieldCheck, UserCheck, UserX, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DashHeader } from "@/components/dashboard/app-shell";
import { DataTable, FilterSelect, SearchInput, type Column } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Menu, MenuButton, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Avatar, Badge } from "@/components/ui/primitives";
import { useAdminUsers, useUpdateUser } from "@/hooks/use-admin";
import { useAuth } from "@/hooks/use-auth";
import { useDebounced } from "@/hooks/use-manage";
import type { AdminUser, UserStatus } from "@/lib/api/admin";
import { ApiError, errorMessage } from "@/lib/api/client";
import type { Role } from "@/lib/api/types";
import { formatDate, formatRelative } from "@/lib/format";

const ROLE_LABEL: Record<Role, string> = { attendee: "Attendee", organizer: "Organizer", admin: "Admin" };
const STATUS_TONE: Record<UserStatus, "success" | "danger" | "neutral"> = { active: "success", suspended: "danger", deleted: "neutral" };

type Pending =
  | { user: AdminUser; kind: "status"; status: "active" | "suspended" }
  | { user: AdminUser; kind: "role"; role: Role };

export function AdminUsers() {
  const { user: me } = useAuth();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [status, setStatus] = useState<UserStatus | "">("");
  const search = useDebounced(q.trim(), 300);
  const list = useAdminUsers({ q: search || undefined, role: role || undefined, status: status || undefined });
  const update = useUpdateUser();
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = () => {
    if (!pending) return;
    const body = pending.kind === "status" ? { status: pending.status } : { role: pending.role };
    update.mutate(
      { id: pending.user.id, body },
      {
        onSuccess: () => {
          toast.success(
            pending.kind === "status"
              ? pending.status === "suspended"
                ? `${pending.user.fullName} is suspended and signed out everywhere`
                : `${pending.user.fullName} can sign in again`
              : `${pending.user.fullName} is now ${ROLE_LABEL[pending.role].toLowerCase()}`,
          );
          setPending(null);
        },
        onError: (err) => {
          setPending(null);
          toast.error(err instanceof ApiError && err.code === "CANNOT_MODIFY_SELF" ? "You can't change your own role or status." : errorMessage(err));
        },
      },
    );
  };

  const columns: Column<AdminUser>[] = [
    {
      key: "user",
      header: "User",
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.fullName} className="size-8 text-[12px]" />
          <div className="min-w-0">
            <p className="truncate font-medium">
              {u.fullName}
              {u.id === me?.id && <span className="ml-1.5 text-[12px] font-normal text-muted">(you)</span>}
            </p>
            <p className="truncate text-[13px] text-muted">
              {u.email}
              {!u.emailVerified && " · unverified"}
            </p>
          </div>
        </div>
      ),
    },
    { key: "role", header: "Role", cell: (u) => <Badge tone={u.role === "admin" ? "dark" : "neutral"}>{ROLE_LABEL[u.role]}</Badge> },
    { key: "status", header: "Status", cell: (u) => <Badge tone={STATUS_TONE[u.status]} dot>{u.status[0].toUpperCase() + u.status.slice(1)}</Badge> },
    {
      key: "seen",
      header: "Last sign-in",
      cell: (u) => <span className="text-[13px] text-muted">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : "Never"}</span>,
    },
    { key: "joined", header: "Joined", cell: (u) => <span className="text-[13px] text-muted">{formatDate(u.createdAt)}</span> },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-12",
      cell: (u) =>
        u.id === me?.id || u.status === "deleted" ? null : (
          <Menu
            trigger={(props) => (
              <button {...props} type="button" aria-label={`Actions for ${u.fullName}`} className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-ink/5 hover:text-ink">
                <MoreHorizontal className="size-4" />
              </button>
            )}
          >
            {u.status === "active" ? (
              <MenuButton icon={<UserX className="size-4" />} onSelect={() => setPending({ user: u, kind: "status", status: "suspended" })} danger>
                Suspend
              </MenuButton>
            ) : (
              <MenuButton icon={<UserCheck className="size-4" />} onSelect={() => setPending({ user: u, kind: "status", status: "active" })}>
                Reactivate
              </MenuButton>
            )}
            <MenuSeparator />
            <MenuLabel>
              <span className="text-[12px] text-muted">Change role</span>
            </MenuLabel>
            {(["attendee", "organizer", "admin"] as Role[])
              .filter((r) => r !== u.role)
              .map((r) => (
                <MenuButton key={r} icon={<ShieldCheck className="size-4" />} onSelect={() => setPending({ user: u, kind: "role", role: r })}>
                  Make {ROLE_LABEL[r].toLowerCase()}
                </MenuButton>
              ))}
          </Menu>
        ),
    },
  ];

  return (
    <>
      <DashHeader eyebrow="Admin" title="Users" description="Find accounts, suspend abuse, change roles. Every change is in the audit log." />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <SearchInput value={q} onChange={setQ} placeholder="Name or email" label="Search users" busy={list.isFetching && !list.isFetchingNextPage} className="sm:flex-1" />
        <div className="flex gap-3">
          <FilterSelect
            label="Role"
            value={role}
            onChange={setRole}
            options={[{ value: "", label: "All roles" }, ...(["attendee", "organizer", "admin"] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))]}
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "Any status" },
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
              { value: "deleted", label: "Deleted" },
            ]}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(u) => u.id}
        loading={list.isPending}
        error={list.isError ? errorMessage(list.error) : null}
        empty={{ icon: <Users className="size-5" />, title: "No users match", description: "Try another search or filter." }}
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => list.fetchNextPage()}
      />

      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={confirm}
        loading={update.isPending}
        destructive={pending?.kind === "status" ? pending.status === "suspended" : pending?.role === "admin"}
        title={
          !pending
            ? ""
            : pending.kind === "status"
              ? pending.status === "suspended"
                ? `Suspend ${pending.user.fullName}?`
                : `Reactivate ${pending.user.fullName}?`
              : `Make ${pending.user.fullName} ${ROLE_LABEL[pending.role].toLowerCase()}?`
        }
        description={
          !pending
            ? undefined
            : pending.kind === "status"
              ? pending.status === "suspended"
                ? "They're signed out on every device right away and can't sign in until reactivated. Their bookings and events stay."
                : "They can sign in and book again."
              : pending.role === "admin"
                ? "Admins can see and change everything, including users, refunds and other admins. Only do this for people you trust."
                : pending.role === "attendee" && pending.user.role === "organizer"
                  ? "They lose access to the organizer dashboard. Their organizer profile and events aren't deleted."
                  : "The new role applies on their next request."
        }
        confirmLabel={pending?.kind === "status" ? (pending.status === "suspended" ? "Suspend" : "Reactivate") : "Change role"}
      />
    </>
  );
}
