import type { Metadata } from "next";
import { DoorEventPicker } from "@/components/check-in/event-picker";

// rendered client-side behind <RequireAuth> (see the (scanner) layout)
export const instant = false;

export const metadata: Metadata = { title: "Check in guests", robots: { index: false } };

export default function Page() {
  return <DoorEventPicker />;
}
