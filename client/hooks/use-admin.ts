"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, type CategoryInput } from "@/lib/api/admin";
import { keys } from "@/lib/api/keys";
import { cursorPagination, flattenPages, type Page } from "@/lib/api/pagination";

const ADMIN = ["admin"] as const;
const k = {
  stats: [...ADMIN, "stats"] as const,
  list: (name: string, filter: Record<string, unknown>) => [...ADMIN, name, filter] as const,
  all: (name: string) => [...ADMIN, name] as const,
};

/** Infinite, filterable admin list. Keeps old rows visible while the filter changes. */
function useAdminList<T, F extends Record<string, unknown>>(name: string, filter: F, fetch: (p: F & { cursor?: string }) => Promise<Page<T>>) {
  const query = useInfiniteQuery({
    queryKey: k.list(name, filter),
    queryFn: ({ pageParam }) => fetch({ ...filter, cursor: pageParam, limit: 50 }),
    ...cursorPagination<T>(),
    placeholderData: keepPreviousData,
  });
  return { ...query, rows: flattenPages(query.data?.pages) };
}

/** Drop undefined/empty filter values so query keys stay stable. */
export const clean = <F extends Record<string, unknown>>(f: F) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "")) as F;

export function useAdminStats() {
  return useQuery({ queryKey: k.stats, queryFn: adminApi.stats, refetchInterval: 60_000 });
}

// ───────────── users ─────────────

export const useAdminUsers = (f: Parameters<typeof adminApi.users>[0]) => useAdminList("users", clean(f), adminApi.users);

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof adminApi.updateUser>[1] }) => adminApi.updateUser(v.id, v.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: k.all("users") });
      void qc.invalidateQueries({ queryKey: k.stats });
    },
  });
}

// ───────────── organizers ─────────────

export const useAdminOrganizers = (f: Parameters<typeof adminApi.organizers>[0]) =>
  useAdminList("organizers", clean(f), adminApi.organizers);

export function useReviewOrganizer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; status: "verified" | "rejected"; note?: string }) =>
      adminApi.review(v.userId, { status: v.status, ...(v.note ? { note: v.note } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: k.all("organizers") });
      void qc.invalidateQueries({ queryKey: k.stats });
    },
  });
}

// ───────────── categories ─────────────

/** Category writes change the public tree too (filters, event forms). */
function useCategoryMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: keys.categories.all }) });
}

export const useCreateCategory = () => useCategoryMutation((body: CategoryInput) => adminApi.createCategory(body));
export const useUpdateCategory = () =>
  useCategoryMutation((v: { id: string; body: Partial<CategoryInput> }) => adminApi.updateCategory(v.id, v.body));
export const useDeleteCategory = () => useCategoryMutation((id: string) => adminApi.deleteCategory(id));

// ───────────── payments & refunds ─────────────

export const useAdminPayments = (f: Parameters<typeof adminApi.payments>[0]) =>
  useAdminList("payments", clean(f), adminApi.payments);

export const useAdminRefunds = (f: Parameters<typeof adminApi.refunds>[0]) => useAdminList("refunds", clean(f), adminApi.refunds);

export function useRefundAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; action: "complete" | "retry"; providerRefundId?: string }) =>
      v.action === "complete" ? adminApi.completeRefund(v.id, v.providerRefundId) : adminApi.retryRefund(v.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: k.all("refunds") });
      void qc.invalidateQueries({ queryKey: k.all("payments") });
      void qc.invalidateQueries({ queryKey: k.stats });
    },
  });
}

// ───────────── audit log ─────────────

export const useAuditLog = (f: Parameters<typeof adminApi.auditLogs>[0]) => useAdminList("audit", clean(f), adminApi.auditLogs);
