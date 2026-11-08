"use client";

import { ImageUp, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { errorMessage } from "@/lib/api/client";
import { checkImage, MIN_SIZE, uploadImage, type Upload, type UploadPurpose } from "@/lib/api/uploads";
import { cn } from "@/lib/utils";

type State =
  | { kind: "idle" }
  | { kind: "uploading"; pct: number }
  | { kind: "processing" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

/**
 * Picks an image, uploads it straight to storage and waits until the worker has processed it.
 * `onReady` gets the upload (use `upload.id` as logoUploadId / coverUploadId).
 * `currentUrl` shows the existing image (e.g. the saved logo) until a new one is picked.
 */
export function ImageUpload({
  purpose,
  label,
  currentUrl,
  onReady,
  onClear,
  onBusyChange,
  hint,
}: {
  purpose: UploadPurpose;
  label: string;
  currentUrl?: string | null;
  onReady: (upload: Upload) => void;
  onClear?: () => void;
  onBusyChange?: (busy: boolean) => void;
  hint?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const square = purpose === "organizer_logo";
  const min = MIN_SIZE[purpose];
  const busy = state.kind === "uploading" || state.kind === "processing";

  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  // free the object URL and stop an in-flight upload when leaving
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const start = async (file: File) => {
    const problem = await checkImage(file, purpose);
    if (problem) return setState({ kind: "error", message: problem });

    setPreview(URL.createObjectURL(file)); // show it right away
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ kind: "uploading", pct: 0 });
    try {
      const upload = await uploadImage(file, purpose, {
        signal: ctrl.signal,
        onProgress: (pct) => setState({ kind: "uploading", pct }),
        onStage: (stage) => stage === "processing" && setState({ kind: "processing" }),
      });
      setState({ kind: "ready" });
      onReady(upload);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setState({ kind: "error", message: errorMessage(err) });
    }
  };

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void start(file);
    if (inputRef.current) inputRef.current.value = ""; // allow picking the same file again
  };

  const shown = preview ?? currentUrl ?? null;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      <div className={cn("flex gap-4", square ? "items-center" : "flex-col")}>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) pick(e.dataTransfer.files);
          }}
          className={cn(
            "relative shrink-0 overflow-hidden border bg-card transition",
            square ? "size-28 rounded-2xl" : "aspect-[16/9] w-full rounded-2xl",
            dragging ? "border-ink shadow-[0_0_0_3px_rgb(255_90_31/0.18)]" : "border-dashed border-ink/20",
            state.kind === "error" && "border-red-400",
          )}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview / processed variant
            <img src={shown} alt="" className={cn("size-full object-cover", busy && "opacity-60")} />
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex size-full flex-col items-center justify-center gap-2 text-muted transition hover:text-ink"
            >
              <ImageUp className={square ? "size-6" : "size-7"} />
              {!square && <span className="text-[13.5px]">Drop an image here or click to choose</span>}
            </button>
          )}

          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-ink/30 text-paper">
              <div className="flex flex-col items-center gap-2">
                <LoaderCircle className="size-6 animate-spin" />
                {!square && (
                  <span className="text-[12.5px] font-medium">
                    {state.kind === "uploading" ? `Uploading ${state.pct}%` : "Processing…"}
                  </span>
                )}
              </div>
              {state.kind === "uploading" && (
                <span className="absolute inset-x-0 bottom-0 h-1 bg-paper/30">
                  <span className="block h-full bg-accent transition-[width]" style={{ width: `${state.pct}%` }} />
                </span>
              )}
            </div>
          )}
        </div>

        <div className={cn("flex flex-wrap items-center gap-2", !square && "justify-between")}>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => pick(e.target.files)}
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[13.5px] font-medium transition hover:border-ink/30 disabled:opacity-60"
          >
            {state.kind === "error" ? <RotateCcw className="size-3.5" /> : <ImageUp className="size-3.5" />}
            {shown ? "Replace image" : "Choose image"}
          </button>
          {shown && onClear && !busy && (
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setState({ kind: "idle" });
                onClear();
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13.5px] text-muted transition hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="size-3.5" /> Remove
            </button>
          )}
          <p className={cn("text-[12.5px]", state.kind === "error" ? "text-red-600" : "text-muted", square && "basis-full")} role={state.kind === "error" ? "alert" : undefined}>
            {state.kind === "error"
              ? state.message
              : state.kind === "ready"
                ? "Uploaded and ready."
                : (hint ?? `JPEG, PNG or WebP, up to 5 MB, at least ${min.width}×${min.height}px.`)}
          </p>
        </div>
      </div>
    </div>
  );
}
