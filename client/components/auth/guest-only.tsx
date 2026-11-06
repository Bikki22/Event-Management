"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { safeRedirect } from "@/lib/utils";

/** Sends already signed-in users away from login/register to `?next=` (or home). */
export function useRedirectIfAuthenticated() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const next = safeRedirect(useSearchParams().get("next"));

  useEffect(() => {
    if (isAuthenticated) router.replace(next);
  }, [isAuthenticated, next, router]);

  return next;
}
