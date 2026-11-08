"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountApi, type Session, type UpdateProfileInput } from "@/lib/api/account";
import { keys } from "@/lib/api/keys";
import { useAuthStore } from "@/stores/auth-store";

export function useUpdateProfile() {
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => accountApi.updateProfile(input),
    onSuccess: ({ user }) => setUser(user),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { currentPassword: string; newPassword: string }) =>
      accountApi.changePassword(v.currentPassword, v.newPassword),
    // the server signs out every other device
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me.sessions() }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: keys.me.sessions(),
    queryFn: async () => {
      const { data } = await accountApi.sessions();
      // current device first, then most recently used
      return [...data].sort(
        (a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt.localeCompare(a.lastUsedAt),
      );
    },
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => accountApi.revokeSession(id),
    // drop the row right away; refetch afterwards to stay correct
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.me.sessions() });
      const prev = qc.getQueryData<Session[]>(keys.me.sessions());
      qc.setQueryData<Session[]>(keys.me.sessions(), (list) => list?.filter((s) => s.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.me.sessions(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.me.sessions() }),
  });
}
