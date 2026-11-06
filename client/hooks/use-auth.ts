"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi, type LoginInput, type RegisterInput } from "@/lib/api/auth";
import { broadcastAuth } from "@/lib/auth-channel";
import { useAuthStore } from "@/stores/auth-store";

export function useAuth() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  return { status, user, isAuthenticated: status === "authenticated", isBooting: status === "booting" };
}

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (input: LoginInput) => authApi.login(input),
    onSuccess: (data) => {
      setSession(data);
      broadcastAuth("login");
    },
  });
}

export function useRegister() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (input: RegisterInput) => authApi.register(input),
    onSuccess: (data) => {
      setSession(data);
      broadcastAuth("login");
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    // even if the request fails (expired token, offline), the local session is dropped
    mutationFn: () => authApi.logout().catch(() => undefined),
    onSettled: () => {
      clear();
      qc.clear();
      broadcastAuth("logout");
    },
  });
}

export function useForgotPassword() {
  return useMutation({ mutationFn: (email: string) => authApi.forgotPassword(email) });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (v: { token: string; password: string }) => authApi.resetPassword(v.token, v.password),
  });
}

export function useResendVerification() {
  return useMutation({ mutationFn: () => authApi.resendVerification() });
}
