import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/button";
import { Logo, LogoMark } from "@/components/ui/logo";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-1 flex-col px-5 sm:px-8">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center py-20">
        <div className="flex items-center gap-4 font-mono text-[12px] uppercase tracking-[0.08em] text-muted">
          <LogoMark className="size-6 -rotate-6" />
          Error 404 · No such page
        </div>
        <h1 className="mt-6 max-w-3xl text-[clamp(2.75rem,7vw,5.5rem)] font-semibold leading-[0.95] tracking-[-0.05em]">
          This ticket doesn&apos;t scan.
        </h1>
        <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-muted">
          The page you&apos;re looking for was moved, ended, or never existed. Let&apos;s find you something else to do.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <LinkButton href="/events" className="h-12 px-6">
            Browse events
          </LinkButton>
          <LinkButton href="/" variant="secondary" className="h-12 px-6">
            Back to home
          </LinkButton>
        </div>
      </main>
    </div>
  );
}
