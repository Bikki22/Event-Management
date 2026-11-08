import { Construction } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";
import { Container, PageHeader } from "./page-header";

/** Temporary page for routes the nav already links to; replaced phase by phase (see frontend.md). */
export function ComingSoon({ title, description, phase }: { title: string; description: string; phase: number }) {
  return (
    <Container className="py-12 sm:py-16">
      <PageHeader eyebrow={`Phase ${phase}`} title={title} />
      <EmptyState
        className="mt-10"
        icon={<Construction className="size-5" />}
        title="Coming soon"
        description={description}
        action={
          <LinkButton href="/" variant="secondary">
            Back to home
          </LinkButton>
        }
      />
    </Container>
  );
}
