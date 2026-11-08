"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select, Textarea } from "@/components/ui/inputs";
import { useCategories } from "@/hooks/use-events";
import { useUpdateEvent } from "@/hooks/use-manage";
import { ApiError } from "@/lib/api/client";
import type { CategoryNode } from "@/lib/api/catalog";
import { VISIBILITY, type EventInput, type ManageEvent } from "@/lib/api/manage";
import { applyServerErrors } from "@/lib/form-errors";
import { basicsSchema, splitTags, type BasicsValues } from "@/lib/validation/event";
import { ConflictBanner, ReadOnlyNote, StepCard, StepFooter, useVersionBase, type StepProps } from "./shared";

const FIELDS = ["title", "slug", "summary", "description", "categoryId", "visibility", "tags"] as const;

export const basicsFrom = (e?: ManageEvent): BasicsValues => ({
  title: e?.title ?? "",
  slug: e?.slug ?? "",
  summary: e?.summary ?? "",
  description: e?.description ?? "",
  categoryId: e?.categoryId ?? "",
  visibility: e?.visibility ?? "public",
  tags: e?.metadata?.tags?.join(", ") ?? "",
});

/** Form values → request fields. `metadata` keeps the FAQs that this form doesn't edit. */
export function basicsBody(v: BasicsValues, e?: ManageEvent): Partial<EventInput> {
  const tags = splitTags(v.tags);
  return {
    title: v.title,
    ...(e && e.status === "draft" && v.slug && v.slug !== e.slug ? { slug: v.slug } : {}),
    summary: v.summary || null,
    description: v.description || null,
    categoryId: v.categoryId || null,
    visibility: v.visibility,
    metadata: { ...(e?.metadata ?? {}), tags },
  };
}

/** Flattened category tree for a <select>: parents, then their children indented. */
function categoryOptions(tree: CategoryNode[] | undefined) {
  return (tree ?? []).flatMap((c) => [
    { value: c.id, label: c.name },
    ...c.children.map((ch) => ({ value: ch.id, label: `   — ${ch.name}` })),
  ]);
}

export function BasicsFields({ form, editingSlug }: { form: ReturnType<typeof useForm<BasicsValues>>; editingSlug: "edit" | "locked" | "hidden" }) {
  const categories = useCategories();
  const options = useMemo(() => categoryOptions(categories.data), [categories.data]);
  const {
    register,
    control,
    formState: { errors },
  } = form;
  const [summary, visibility] = useWatch({ control, name: ["summary", "visibility"] });

  return (
    <>
      <Field label="Event title" placeholder="Kathmandu Jazz Night" error={errors.title?.message} {...register("title")} />
      {editingSlug !== "hidden" && (
        <Field
          label="Event address"
          readOnly={editingSlug === "locked"}
          className={editingSlug === "locked" ? "bg-ink/[0.03] text-muted" : undefined}
          error={errors.slug?.message}
          hint={
            <p className="text-[12.5px] text-muted">
              {editingSlug === "locked" ? "Locked once the event is published, so shared links keep working." : "bookevent.com/events/…"}
            </p>
          }
          {...register("slug")}
        />
      )}
      <Textarea
        label="Summary"
        rows={2}
        placeholder="One or two sentences for event cards and link previews."
        error={errors.summary?.message}
        labelAside={<span className="text-[12px] text-muted">{summary?.length ?? 0}/300</span>}
        hint="Required to publish."
        {...register("summary")}
      />
      <Textarea
        label="Description"
        rows={7}
        placeholder="What to expect, line-up, schedule, what's included, age limits…"
        error={errors.description?.message}
        {...register("description")}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Select
          label="Category"
          placeholder={categories.isPending ? "Loading…" : "Choose a category"}
          options={options}
          error={errors.categoryId?.message}
          hint="Required to publish."
          {...register("categoryId")}
        />
        <Select
          label="Visibility"
          options={Object.entries(VISIBILITY).map(([value, v]) => ({ value, label: v.label }))}
          hint={VISIBILITY[visibility ?? "public"].hint}
          {...register("visibility")}
        />
      </div>
      <Field
        label="Tags"
        placeholder="jazz, live music, outdoor"
        error={errors.tags?.message}
        labelAside={<span className="text-[12px] text-muted">Optional</span>}
        hint={<p className="text-[12.5px] text-muted">Separate with commas. Up to 10.</p>}
        {...register("tags")}
      />
    </>
  );
}

export function useBasicsForm(initial: BasicsValues) {
  return useForm<BasicsValues>({ resolver: zodResolver(basicsSchema), defaultValues: initial });
}

/** Editing an existing event. */
export function BasicsStep({ event, reload, onDirtyChange, goTo, readOnly }: StepProps) {
  const form = useBasicsForm(basicsFrom(event));
  const { handleSubmit, setError, reset, formState } = form;
  const update = useUpdateEvent(event.id);
  const [formError, setFormError] = useState<string | null>(null);
  const v = useVersionBase(event, formState.isDirty, (e, keepEdits) =>
    reset(basicsFrom(e), { keepDirtyValues: keepEdits }),
  );

  useEffect(() => onDirtyChange(formState.isDirty), [formState.isDirty, onDirtyChange]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (!formState.isDirty) return goTo("schedule");
    try {
      const { event: saved } = await update.mutateAsync({ version: v.base(), body: basicsBody(values, event) });
      v.saved(saved);
      toast.success("Saved");
      goTo("schedule", { saved: true });
    } catch (err) {
      if (await v.handleConflict(err, reload)) return;
      if (err instanceof ApiError && (err.code === "SLUG_TAKEN" || err.code === "SLUG_LOCKED")) {
        setError("slug", { type: "server", message: err.code === "SLUG_TAKEN" ? "That address is taken. Try another." : err.message });
        return;
      }
      setFormError(applyServerErrors(err, setError, FIELDS, { "metadata.tags": "tags" }));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      {readOnly && <ReadOnlyNote event={event} />}
      <ConflictBanner show={v.conflict} />
      <fieldset disabled={readOnly} className="min-w-0">
        <StepCard title="Basics" description="What the event is. You can change all of this later.">
          <FormAlert message={formError} />
          <BasicsFields form={form} editingSlug={event.status === "draft" ? "edit" : "locked"} />
        </StepCard>
      </fieldset>
      <StepFooter>
        {!readOnly && (
          <Button type="submit" loading={update.isPending}>
            {formState.isDirty ? "Save and continue" : "Continue"}
          </Button>
        )}
      </StepFooter>
    </form>
  );
}
