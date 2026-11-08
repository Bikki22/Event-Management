"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import type { ManageEvent } from "@/lib/api/manage";
import { cn } from "@/lib/utils";

export type StepId = "basics" | "schedule" | "cover" | "tickets" | "publish";

export const STEP_IDS: StepId[] = ["basics", "schedule", "cover", "tickets", "publish"];
export const isStepId = (v: string | null): v is StepId => STEP_IDS.includes(v as StepId);

/** What a step needs from the wizard. */
export interface StepProps {
  event: ManageEvent;
  /** refetches the event and resolves to the fresh copy (used after a 412) */
  reload: () => Promise<ManageEvent | null>;
  onDirtyChange: (dirty: boolean) => void;
  /** `saved: true` skips the unsaved-changes prompt (the form was just saved) */
  goTo: (step: StepId, opts?: { saved?: boolean }) => void;
  readOnly: boolean;
}

/**
 * If-Match bookkeeping for a form. `base` is the version the form was loaded from and is what
 * goes into If-Match, so a save never silently overwrites someone else's changes.
 *
 * When the event changes elsewhere (another tab, a teammate) and the form has no edits, the
 * form just follows it. With edits, a 412 marks a conflict: the fresh version becomes the base,
 * untouched fields take the fresh values and edited fields keep the user's input
 * (`keepEdits`), so one more "Save" applies just their edits on top.
 */
export function useVersionBase(
  event: ManageEvent,
  isDirty: boolean,
  resetFrom: (e: ManageEvent, keepEdits?: boolean) => void,
) {
  // read only in submit handlers, so a ref (no re-render needed when it moves)
  const base = useRef(event.version);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    if (event.version === base.current || isDirty) return;
    // a newer version arrived and there are no local edits: follow it
    resetFrom(event);
    base.current = event.version;
    // only when a newer version arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.version]);

  /** Returns true when the error was a version conflict (and has been handled). */
  const handleConflict = async (err: unknown, reload: () => Promise<ManageEvent | null>) => {
    if (!(err instanceof ApiError) || err.code !== "PRECONDITION_FAILED") return false;
    const fresh = await reload();
    if (fresh) {
      resetFrom(fresh, true);
      base.current = fresh.version;
    }
    setConflict(true);
    return true;
  };

  const saved = (e: ManageEvent) => {
    resetFrom(e);
    base.current = e.version;
    setConflict(false);
  };

  // once the edits are saved or discarded there's nothing left to warn about
  return { base: () => base.current, conflict: conflict && isDirty, handleConflict, saved };
}

export function ConflictBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div role="alert" className="mb-6 flex gap-3 rounded-xl border-l-[3px] border-amber-500 bg-amber-50 px-4 py-3 text-[13.5px] leading-snug text-amber-950">
      <RefreshCw className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-semibold">This event was changed somewhere else.</span> We loaded the latest version and
        kept your edits in the form. Check them and save again to apply them on top.
      </p>
    </div>
  );
}

export function ReadOnlyNote({ event }: { event: ManageEvent }) {
  return (
    <div className="mb-6 rounded-xl border border-line bg-ink/[0.03] px-4 py-3 text-[13.5px] text-muted">
      This event is {event.status === "cancelled" ? "cancelled" : "over"}, so it can&apos;t be edited anymore.
    </div>
  );
}

/** Sticky bottom bar with the step's buttons. */
export function StepFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mx-5 mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-paper/90 px-5 py-4 backdrop-blur-md sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Card wrapper used by each step. */
export function StepCard({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
      <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
      {description && <p className="mt-1 text-[14px] leading-relaxed text-muted">{description}</p>}
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

/** Completion per step, for the stepper ticks (mirrors the server's publish checks). */
export function stepDone(e: ManageEvent | undefined): Record<StepId, boolean> {
  if (!e) return { basics: false, schedule: false, cover: false, tickets: false, publish: false };
  return {
    basics: !!e.summary && !!e.categoryId,
    schedule: (e.mode === "online" || !!e.venueId) && (e.mode === "in_person" || !!e.onlineUrl),
    cover: !!e.coverImage,
    tickets: e.ticketTypes.some((t) => t.isActive),
    publish: e.status !== "draft",
  };
}
