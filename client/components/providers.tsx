"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { authApi } from "@/lib/api/auth";
import { ApiError, refreshSession } from "@/lib/api/client";
import { onAuthBroadcast } from "@/lib/auth-channel";
import { useAuthStore } from "@/stores/auth-store";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => {
          // don't retry client errors (401, 404, validation...)
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
          return count < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

/** Restores the session from the refresh cookie on load. */
async function restoreSession() {
  const { clear, setUser } = useAuthStore.getState();
  try {
    const token = await refreshSession();
    if (!token) return clear();
    const { user } = await authApi.me();
    setUser(user);
  } catch {
    clear();
  }
}

let restoring: Promise<void> | null = null;

function AuthBootstrap() {
  const expiresAt = useAuthStore((s) => s.expiresAt);
  const status = useAuthStore((s) => s.status);

  // once per page load (module-level guard survives StrictMode's double effect)
  useEffect(() => {
    restoring ??= restoreSession();
  }, []);

  // refresh the access token a minute before it expires
  useEffect(() => {
    if (status !== "authenticated" || !expiresAt) return;
    const delay = Math.max(expiresAt - Date.now() - 60_000, 5_000);
    const id = window.setTimeout(() => void refreshSession().catch(() => undefined), delay);
    return () => window.clearTimeout(id);
  }, [expiresAt, status]);

  // cross-tab sync
  useEffect(
    () =>
      onAuthBroadcast((event) => {
        if (event === "logout") useAuthStore.getState().clear();
        else if (useAuthStore.getState().status !== "authenticated") void restoreSession();
      }),
    [],
  );

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <AuthBootstrap />
        {children}
        <Toaster
          theme="light"
          position="bottom-center"
          toastOptions={{
            classNames: {
              toast: "!bg-ink !text-paper !border-0 !rounded-xl !shadow-lg",
              description: "!text-paper/60",
            },
          }}
        />
      </MotionConfig>
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </QueryClientProvider>
  );
}
