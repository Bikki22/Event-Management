import type { Metadata } from "next";
import { AdminCategories } from "@/components/admin/categories";

// rendered client-side behind the shell's auth/role guard
export const instant = false;

export const metadata: Metadata = { title: "Categories", robots: { index: false } };

export default function Page() {
  return <AdminCategories />;
}
