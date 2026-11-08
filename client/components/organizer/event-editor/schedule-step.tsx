"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Globe, MapPin, MonitorPlay } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/inputs";
import { useCreateEvent, useUpdateEvent } from "@/hooks/use-manage";
import { ApiError } from "@/lib/api/client";
import type { EventMode, Venue } from "@/lib/api/events";
import type { EventInput, ManageEvent } from "@/lib/api/manage";
import { applyServerErrors } from "@/lib/form-errors";
import { scheduleSchema, type BasicsValues, type ScheduleValues } from "@/lib/validation/event";
import { fromLocalInput, offsetLabel, timeZoneOptions, toLocalInput } from "@/lib/zoned";
import { cn } from "@/lib/utils";
import { basicsBody } from "./basics-step";
import { ConflictBanner, ReadOnlyNote, StepCard, StepFooter, useVersionBase, type StepProps } from "./shared";
import { VenuePicker } from "./venue-picker";

const FIELDS = ["mode", "venueId", "onlineUrl", "timezone", "startsAt", "endsAt"] as const;

const MODES: { value: EventMode; label: string; hint: string; icon: typeof MapPin }[] = [
  { value: "in_person", label: "In person", hint: "At a venue", icon: MapPin },
  { value: "online", label: "Online", hint: "Video call or stream", icon: MonitorPlay },
  { value: "hybrid", label: "Hybrid", hint: "Venue + online", icon: Globe },
];

const scheduleFrom = (e?: ManageEvent): ScheduleValues => {
  const tz = e?.timezone ?? "Asia/Kathmandu";
  return {
    mode: e?.mode ?? "in_person",
    venueId: e?.venueId ?? "",
    onlineUrl: e?.onlineUrl ?? "",
    timezone: tz,
    startsAt: toLocalInput(e?.startsAt, tz),
    endsAt: toLocalInput(e?.endsAt, tz),
  };
};

function scheduleBody(v: ScheduleValues) {
  return {
    mode: v.mode,
    venueId: v.mode === "online" ? null : v.venueId || null,
    onlineUrl: v.mode === "in_person" ? null : v.onlineUrl || null,
    timezone: v.timezone,
    startsAt: fromLocalInput(v.startsAt, v.timezone)!,
    endsAt: fromLocalInput(v.endsAt, v.timezone)!,
  };
}

/** Maps the API's business errors onto the right inputs. Returns true if handled. */
function placeError(err: unknown, setError: ReturnType<typeof useForm<ScheduleValues>>["setError"]): boolean {
  if (!(err instanceof ApiError)) return false;
  const at = {
    INVALID_DATES: "startsAt",
    VENUE_REQUIRED: "venueId",
    INVALID_VENUE: "venueId",
  }[err.code] as keyof ScheduleValues | undefined;
  if (!at) return false;
  setError(at, { type: "server", message: err.message }, { shouldFocus: true });
  return true;
}

function ScheduleFields({
  form,
  venue,
  setVenue,
  disabled,
}: {
  form: ReturnType<typeof useForm<ScheduleValues>>;
  venue: Venue | null;
  setVenue: (v: Venue) => void;
  disabled?: boolean;
}) {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = form;
  const [mode, timezone] = useWatch({ control, name: ["mode", "timezone"] });
  const zones = useMemo(() => timeZoneOptions(), []);

  return (
    <>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-ink">Where does it happen?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.value;
            return (
              <label
                key={m.value}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition",
                  active ? "border-ink bg-ink/[0.03]" : "border-line hover:border-ink/25",
                  disabled && "cursor-not-allowed opacity-70",
                )}
              >
                <input type="radio" value={m.value} className="sr-only" {...register("mode")} />
                <Icon className={cn("size-5 shrink-0", active ? "text-accent" : "text-muted")} />
                <span>
                  <span className="block text-[14px] font-medium">{m.label}</span>
                  <span className="block text-[12.5px] text-muted">{m.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {mode !== "online" && (
        <VenuePicker
          selected={venue}
          disabled={disabled}
          error={errors.venueId?.message}
          onSelect={(v) => {
            setVenue(v);
            setValue("venueId", v.id, { shouldDirty: true, shouldValidate: true });
          }}
        />
      )}

      {mode !== "in_person" && (
        <Field
          label="Online link"
          type="url"
          placeholder="https://meet.google.com/abc-defg-hij"
          error={errors.onlineUrl?.message}
          hint={<p className="text-[12.5px] text-muted">Only ticket holders see it. Required to publish.</p>}
          {...register("onlineUrl")}
        />
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Starts" type="datetime-local" error={errors.startsAt?.message} {...register("startsAt")} />
        <Field label="Ends" type="datetime-local" error={errors.endsAt?.message} {...register("endsAt")} />
      </div>
      <Select
        label="Time zone"
        options={zones}
        error={errors.timezone?.message}
        hint={`Times above are in ${timezone.replace(/_/g, " ")} (${offsetLabel(timezone)}), wherever you are now. Buyers see them in this zone too.`}
        {...register("timezone")}
      />
    </>
  );
}

function useScheduleForm(e?: ManageEvent) {
  return useForm<ScheduleValues>({ resolver: zodResolver(scheduleSchema), defaultValues: scheduleFrom(e) });
}

/** Editing an existing event. */
export function ScheduleStep({ event, reload, onDirtyChange, goTo, readOnly }: StepProps) {
  const form = useScheduleForm(event);
  const { handleSubmit, setError, reset, formState } = form;
  const [venue, setVenue] = useState<Venue | null>(event.venue);
  const update = useUpdateEvent(event.id);
  const [formError, setFormError] = useState<string | null>(null);
  const v = useVersionBase(event, formState.isDirty, (e, keepEdits) => {
    // the venue card follows the venue id unless the user picked a different one
    const venueEdited = keepEdits && form.getFieldState("venueId").isDirty;
    reset(scheduleFrom(e), { keepDirtyValues: keepEdits });
    if (!venueEdited) setVenue(e.venue);
  });

  useEffect(() => onDirtyChange(formState.isDirty), [formState.isDirty, onDirtyChange]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (!formState.isDirty) return goTo("cover");
    try {
      const { event: saved } = await update.mutateAsync({ version: v.base(), body: scheduleBody(values) });
      v.saved(saved);
      toast.success("Saved");
      goTo("cover", { saved: true });
    } catch (err) {
      if (await v.handleConflict(err, reload)) return;
      if (placeError(err, setError)) return;
      setFormError(applyServerErrors(err, setError, FIELDS));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      {readOnly && <ReadOnlyNote event={event} />}
      <ConflictBanner show={v.conflict} />
      <fieldset disabled={readOnly} className="min-w-0">
        <StepCard title="When and where">
          <FormAlert message={formError} />
          <ScheduleFields form={form} venue={venue} setVenue={setVenue} disabled={readOnly} />
        </StepCard>
      </fieldset>
      <StepFooter>
        <Button type="button" variant="ghost" onClick={() => goTo("basics")}>
          Back
        </Button>
        {!readOnly && (
          <Button type="submit" loading={update.isPending}>
            {formState.isDirty ? "Save and continue" : "Continue"}
          </Button>
        )}
      </StepFooter>
    </form>
  );
}

/** New event: this step creates the draft (the API needs a mode and dates to create one). */
export function CreateScheduleStep({
  basics,
  onBack,
  onCreated,
}: {
  basics: BasicsValues;
  onBack: () => void;
  onCreated: (e: ManageEvent) => void;
}) {
  const form = useScheduleForm();
  const { handleSubmit, setError } = form;
  const [venue, setVenue] = useState<Venue | null>(null);
  const create = useCreateEvent();
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const s = scheduleBody(values);
    const b = basicsBody(basics);
    const body: EventInput = {
      title: basics.title,
      mode: s.mode,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      timezone: s.timezone,
      visibility: b.visibility,
      ...(b.summary ? { summary: b.summary } : {}),
      ...(b.description ? { description: b.description } : {}),
      ...(b.categoryId ? { categoryId: b.categoryId } : {}),
      ...(s.venueId ? { venueId: s.venueId } : {}),
      ...(s.onlineUrl ? { onlineUrl: s.onlineUrl } : {}),
      ...(b.metadata?.tags?.length ? { metadata: { tags: b.metadata.tags } } : {}),
    };
    try {
      const { event } = await create.mutateAsync(body);
      toast.success("Draft saved");
      onCreated(event);
    } catch (err) {
      if (err instanceof ApiError && err.code === "NOT_AN_ORGANIZER") {
        setFormError("Create your organizer profile before adding events.");
        return;
      }
      if (placeError(err, setError)) return;
      setFormError(applyServerErrors(err, setError, FIELDS));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <StepCard title="When and where" description="Saving this step creates your draft. Nobody else can see it until you publish.">
        <FormAlert message={formError} />
        <ScheduleFields form={form} venue={venue} setVenue={setVenue} />
      </StepCard>
      <StepFooter>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" loading={create.isPending}>
          Save draft and continue
        </Button>
      </StepFooter>
    </form>
  );
}
