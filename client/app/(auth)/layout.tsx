import { Showcase } from "@/components/auth/showcase";
import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 p-3 sm:p-4">
      <div className="grid w-full gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <main className="flex flex-col px-3 py-4 sm:px-8 lg:px-12 xl:px-20">
          <header>
            <Logo />
          </header>

          <div className="flex flex-1 items-center justify-center py-12">
            <div className="w-full max-w-[380px]">{children}</div>
          </div>

          <footer className="flex justify-between text-[12px] text-muted">
            <span>Book Event — tickets for every night out</span>
            <span className="hidden sm:inline">Kathmandu, NP</span>
          </footer>
        </main>

        <aside className="sticky top-4 hidden h-[calc(100dvh-2rem)] lg:block">
          <Showcase />
        </aside>
      </div>
    </div>
  );
}
