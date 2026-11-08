"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ImageUpload } from "@/components/uploads/image-upload";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { useUpdateEvent } from "@/hooks/use-manage";
import { ApiError, errorMessage } from "@/lib/api/client";
import { ReadOnlyNote, StepCard, StepFooter, type StepProps } from "./shared";

/** The cover is saved as soon as the upload is processed; there's nothing else to edit here. */
export function CoverStep({ event, reload, goTo, readOnly }: StepProps) {
  const update = useUpdateEvent(event.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only one field changes, so on a version conflict it's safe to reload and apply it again.
  const save = async (coverUploadId: string | null) => {
    setError(null);
    try {
      await update.mutateAsync({ version: event.version, body: { coverUploadId } });
    } catch (err) {
      if (err instanceof ApiError && err.code === "PRECONDITION_FAILED") {
        const fresh = await reload();
        if (fresh) {
          try {
            await update.mutateAsync({ version: fresh.version, body: { coverUploadId } });
          } catch (again) {
            return setError(errorMessage(again));
          }
        }
      } else {
        return setError(errorMessage(err));
      }
    }
    toast.success(coverUploadId ? "Cover image saved" : "Cover image removed");
  };

  return (
    <div>
      {readOnly && <ReadOnlyNote event={event} />}
      <StepCard
        title="Cover image"
        description="Shown on event cards, the event page and link previews. A wide 16:9 photo works best; we crop and resize it for you."
      >
        <FormAlert message={error} />
        {readOnly ? (
          event.coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- processed variant from our storage
            <img src={event.coverImage.md} alt="" className="aspect-[16/9] w-full rounded-2xl object-cover" />
          ) : (
            <p className="text-[14px] text-muted">No cover image.</p>
          )
        ) : (
          <ImageUpload
            purpose="event_cover"
            label="Cover"
            currentUrl={event.coverImage?.md ?? null}
            onBusyChange={setBusy}
            onReady={(upload) => void save(upload.id)}
            onClear={() => void save(null)}
            hint="JPEG, PNG or WebP, up to 5 MB, at least 640×360px. 1600×900 or larger looks sharpest."
          />
        )}
      </StepCard>
      <StepFooter>
        <Button type="button" variant="ghost" onClick={() => goTo("schedule")}>
          Back
        </Button>
        <Button type="button" onClick={() => goTo("tickets")} disabled={busy} loading={update.isPending}>
          {event.coverImage ? "Continue" : "Skip for now"}
        </Button>
      </StepFooter>
    </div>
  );
}
