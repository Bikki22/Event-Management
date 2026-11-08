"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { organizerApi, type PayoutInput, type ProfileInput } from "@/lib/api/organizer";
import { useAuthStore } from "@/stores/auth-store";

/** The organizer profile, or `null` if the user hasn't applied (404). */
export function useOrganizerProfile(enabled = true) {
  return useQuery({
    queryKey: keys.me.organizerProfile(),
    queryFn: async () => {
      try {
        return (await organizerApi.mine()).profile;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled,
  });
}

/** Applying makes the user an organizer; refresh /me so the role shows everywhere. */
export function useApplyOrganizer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileInput) => organizerApi.apply(body),
    onSuccess: async ({ profile }) => {
      qc.setQueryData(keys.me.organizerProfile(), profile);
      try {
        const { user } = await authApi.me();
        useAuthStore.getState().setUser(user);
      } catch {
        // the role refresh is cosmetic; the next page load picks it up
      }
    },
  });
}

export function useUpdateOrganizer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ProfileInput>) => organizerApi.update(body),
    onSuccess: ({ profile }) => qc.setQueryData(keys.me.organizerProfile(), profile),
  });
}

export function useSetPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PayoutInput) => organizerApi.setPayout(body),
    onSuccess: ({ profile }) => qc.setQueryData(keys.me.organizerProfile(), profile),
  });
}

export function useRemovePayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => organizerApi.removePayout(),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me.organizerProfile() }),
  });
}
