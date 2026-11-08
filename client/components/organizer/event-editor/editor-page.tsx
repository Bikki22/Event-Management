"use client";

import { useManagedEvent } from "@/components/organizer/event-manage-shell";
import { EventWizard } from "./wizard";

export function EventEditorPage() {
  const event = useManagedEvent();
  return <EventWizard event={event} />;
}
