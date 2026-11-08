import { CalendarX2 } from "lucide-react";
import { Container } from "@/components/layout/page-header";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";

export default function EventNotFound() {
  return (
    <Container className="py-20">
      <EmptyState
        icon={<CalendarX2 className="size-5" />}
        title="We couldn't find that event"
        description="It may have been removed, made private, or the link is mistyped."
        action={<LinkButton href="/events">Browse events</LinkButton>}
      />
    </Container>
  );
}
