import type { Metadata } from "next";
import { RequireAuth } from "@/components/auth/guards";
import { ApplyView } from "@/components/organizer/apply-view";

// signed-in only (client-side session)
export const instant = false;

export const metadata: Metadata = {
  title: "Host an event",
  description: "Apply to become an organizer on Book Event and start selling tickets.",
};

export default function Page() {
  return (
    <RequireAuth>
      <ApplyView />
    </RequireAuth>
  );
}
