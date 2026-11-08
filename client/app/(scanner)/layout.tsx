import type { Viewport } from "next";
import { DoorShell } from "@/components/check-in/door-shell";

// Gated on the in-memory session (client-side), so Next can't validate it for instant navigation.
export const instant = false;

// dark browser chrome to match the door screen
export const viewport: Viewport = { themeColor: "#111110" };

/** Door check-in: its own full-screen dark app, no site navbar or footer. */
export default function ScannerLayout({ children }: { children: React.ReactNode }) {
  return <DoorShell>{children}</DoorShell>;
}
