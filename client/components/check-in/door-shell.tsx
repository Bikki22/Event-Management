"use client";

import { RequireAuth } from "@/components/auth/guards";

/**
 * Full-screen dark layout for the door: phones in a dim venue, held in one hand.
 * Any signed-in user can open it; the API decides which events they may scan for.
 */
export function DoorShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-[#111110] text-paper [color-scheme:dark]">
      <RequireAuth>{children}</RequireAuth>
    </div>
  );
}
