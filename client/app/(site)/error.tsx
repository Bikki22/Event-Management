"use client";

import { useEffect } from "react";
import { Container } from "@/components/layout/page-header";
import { Button, LinkButton } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api/client";

// Error boundary for every page inside the site layout (the header and footer stay visible).
export default function SiteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const requestId = error instanceof ApiError ? error.requestId : undefined;

  return (
    <Container className="flex flex-1 flex-col justify-center py-24">
      <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted">Something broke</p>
      <h1 className="mt-4 max-w-xl text-[40px] font-semibold leading-[1.05] tracking-[-0.04em]">
        This page hit a snag.
      </h1>
      <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-muted">
        {error instanceof ApiError ? errorMessage(error) : "An unexpected error happened while loading this page."} Try
        again, and if it keeps happening let us know.
      </p>
      {requestId && <p className="mt-3 font-mono text-[12px] text-muted">Reference: {requestId}</p>}
      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <LinkButton href="/" variant="secondary">
          Back to home
        </LinkButton>
      </div>
    </Container>
  );
}
