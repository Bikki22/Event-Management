import type { Metadata } from "next";
import { ProfilePage } from "@/components/account/profile-form";

// rendered client-side behind <RequireAuth> (see account/layout.tsx)
export const instant = false;

export const metadata: Metadata = { title: "Account" };

export default function Page() {
  return <ProfilePage />;
}
