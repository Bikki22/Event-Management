"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DashHeader } from "@/components/dashboard/app-shell";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Stepper, type StepItem } from "@/components/ui/stepper";
import { useManageEvent } from "@/hooks/use-manage";
import { isReadOnly, type ManageEvent } from "@/lib/api/manage";
import type { BasicsValues } from "@/lib/validation/event";
import { BasicsFields, basicsFrom, BasicsStep, useBasicsForm } from "./basics-step";
import { CoverStep } from "./cover-step";
import { PublishStep } from "./publish-step";
import { CreateScheduleStep, ScheduleStep } from "./schedule-step";
import { isStepId, StepCard, stepDone, StepFooter, type StepId, type StepProps } from "./shared";
import { TicketsStep } from "./tickets-step";
import { Button } from "@/components/ui/button";

const LABELS: Record<StepId, string> = {
  basics: "Basics",
  schedule: "When & where",
  cover: "Cover image",
  tickets: "Tickets",
  publish: "Review & publish",
};
const ORDER: StepId[] = ["basics", "schedule", "cover", "tickets", "publish"];

/** Warn before leaving the page with unsaved edits. */
function useBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}

/** Edit an existing event. The current step lives in `?step=` so the publish checklist can link to it. */
export function EventWizard({ event }: { event: ManageEvent }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fromUrl = params.get("step");
  const step: StepId = isStepId(fromUrl) ? fromUrl : event.status === "draft" ? "basics" : "publish";
  const query = useManageEvent(event.id);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<StepId | null>(null);
  useBeforeUnload(dirty);

  const navigate = useCallback(
    (s: StepId) => {
      setDirty(false);
      router.replace(`${pathname}?step=${s}`, { scroll: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [router, pathname],
  );
  const goTo = useCallback(
    (s: StepId, opts?: { saved?: boolean }) => (dirty && !opts?.saved && s !== step ? setPending(s) : navigate(s)),
    [dirty, step, navigate],
  );

  const reload = useCallback(async () => (await query.refetch()).data ?? null, [query]);
  const done = stepDone(event);
  const steps: StepItem<StepId>[] = ORDER.map((s) => ({ value: s, label: LABELS[s], done: done[s] }));
  const props: StepProps = { event, reload, onDirtyChange: setDirty, goTo, readOnly: isReadOnly(event) };

  return (
    <>
      <Stepper steps={steps} current={step} onSelect={(s) => goTo(s)} className="mb-6" />
      {/* keyed so each step mounts with fresh form state */}
      <div key={step}>
        {step === "basics" && <BasicsStep {...props} />}
        {step === "schedule" && <ScheduleStep {...props} />}
        {step === "cover" && <CoverStep {...props} />}
        {step === "tickets" && <TicketsStep {...props} />}
        {step === "publish" && <PublishStep {...props} />}
      </div>
      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title="Leave without saving?"
        description="You have unsaved changes on this step. They'll be lost if you switch now."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          const s = pending!;
          setPending(null);
          navigate(s);
        }}
      />
    </>
  );
}

/** New event: Basics stays in memory until "When & where" creates the draft. */
export function NewEventWizard() {
  const router = useRouter();
  const [step, setStep] = useState<"basics" | "schedule">("basics");
  const [basics, setBasics] = useState<BasicsValues>(() => basicsFrom());
  const form = useBasicsForm(basics);
  useBeforeUnload(form.formState.isDirty);

  const steps: StepItem<StepId>[] = ORDER.map((s) => ({
    value: s,
    label: LABELS[s],
    done: s === "basics" && step === "schedule",
    locked: s !== "basics" && s !== "schedule",
  }));

  const toSchedule = form.handleSubmit((v) => {
    setBasics(v);
    setStep("schedule");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  return (
    <>
      <DashHeader eyebrow="New event" title="Create an event" description="Your event is saved as a private draft after the second step." />
      <Stepper
        steps={steps}
        current={step}
        onSelect={(s) => (s === "basics" ? setStep("basics") : s === "schedule" ? void toSchedule() : undefined)}
        className="mb-6"
      />
      {step === "basics" ? (
        <form onSubmit={toSchedule} noValidate>
          <StepCard title="Basics" description="What the event is. Summary and category are needed to publish, but you can add them later.">
            <BasicsFields form={form} editingSlug="hidden" />
          </StepCard>
          <StepFooter>
            <Button type="submit">Continue</Button>
          </StepFooter>
        </form>
      ) : (
        <CreateScheduleStep
          basics={basics}
          onBack={() => setStep("basics")}
          onCreated={(e) => {
            form.reset(form.getValues()); // not dirty anymore: don't warn on the redirect
            router.replace(`/dashboard/events/${e.id}?step=cover`);
          }}
        />
      )}
    </>
  );
}
