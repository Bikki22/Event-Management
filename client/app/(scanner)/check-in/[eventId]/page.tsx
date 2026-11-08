import type { Metadata } from "next";
import { Suspense } from "react";
import { ScannerScreen } from "@/components/check-in/scanner-screen";

// rendered client-side behind <RequireAuth> (see the (scanner) layout)
export const instant = false;

export const metadata: Metadata = { title: "Scan tickets", robots: { index: false } };

export default function Page({ params }: PageProps<"/check-in/[eventId]">) {
  return (
    <Suspense fallback={null}>
      {params.then(({ eventId }) => (
        <ScannerScreen eventId={eventId} />
      ))}
    </Suspense>
  );
}
