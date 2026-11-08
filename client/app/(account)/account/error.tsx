"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api/client";

// Error boundary for account sections; the account shell (back logo, sidebar) stays visible.
export default function AccountError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-2xl border border-line bg-card p-8">
      <p className="text-[16px] font-semibold">This section didn&apos;t load</p>
      <p className="mt-1.5 text-[14px] text-muted">
        {error instanceof ApiError ? errorMessage(error) : "An unexpected error happened."}
      </p>
      <Button className="mt-5 h-10" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
