import { Suspense } from "react";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeaderFallback, SiteHeader } from "@/components/layout/site-header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      {/* the header reads the URL (active link, login ?next=), which is runtime data on dynamic routes */}
      <Suspense fallback={<SiteHeaderFallback />}>
        <SiteHeader />
      </Suspense>
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
