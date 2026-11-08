import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/account/change-password-form";

// rendered client-side behind <RequireAuth> (see account/layout.tsx)
export const instant = false;

export const metadata: Metadata = { title: "Password" };

export default function Page() {
  return <ChangePasswordForm />;
}
