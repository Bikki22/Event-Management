"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, MapPin, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Badge, Spinner } from "@/components/ui/primitives";
import { useCreateVenue, useDebounced, useVenues } from "@/hooks/use-manage";
import type { Venue } from "@/lib/api/events";
import { applyServerErrors } from "@/lib/form-errors";
import { venueSchema, type VenueValues } from "@/lib/validation/event";
import { cn } from "@/lib/utils";

/** Search shared venues and your own, or add a new one. */
export function VenuePicker({
  selected,
  onSelect,
  error,
  disabled,
}: {
  selected: Venue | null;
  onSelect: (venue: Venue) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const search = useDebounced(q.trim(), 300);
  const venues = useVenues(search);
  const list = venues.data ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-medium text-ink">Venue</p>
        {!disabled && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[13px] font-medium text-ink/70 hover:text-ink">
            <Plus className="size-3.5" /> Add a venue
          </button>
        )}
      </div>

      {selected && (
        <div className="flex items-center gap-3 rounded-xl border border-ink bg-ink/[0.03] px-4 py-3">
          <MapPin className="size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-medium">{selected.name}</p>
            <p className="truncate text-[12.5px] text-muted">{[selected.addressLine, selected.city].filter(Boolean).join(", ")}</p>
          </div>
          <Check className="size-4 shrink-0" />
        </div>
      )}

      {!disabled && (
        <div className={cn("overflow-hidden rounded-xl border bg-card", error ? "border-red-500" : "border-line")}>
          <div className="relative border-b border-line">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={selected ? "Search for a different venue" : "Search venues by name or city"}
              aria-label="Search venues"
              className="h-11 w-full bg-transparent pl-10 pr-10 text-[14.5px] placeholder:text-ink/30 focus:outline-none"
            />
            {venues.isFetching && <Spinner className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2" />}
          </div>
          <ul className="max-h-60 overflow-y-auto" role="listbox" aria-label="Venues">
            {list.length === 0 && !venues.isPending ? (
              <li className="px-4 py-6 text-center text-[13.5px] text-muted">
                No venues match.{" "}
                <button type="button" onClick={() => setAdding(true)} className="font-medium text-ink underline underline-offset-4">
                  Add it
                </button>
              </li>
            ) : (
              list.map((v) => {
                const active = v.id === selected?.id;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => onSelect(v)}
                      className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-ink/[0.03]", active && "bg-ink/[0.04]")}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{v.name}</p>
                        <p className="truncate text-[12.5px] text-muted">
                          {[v.addressLine, v.city].filter(Boolean).join(", ")}
                          {v.capacity ? ` · ${v.capacity.toLocaleString()} capacity` : ""}
                        </p>
                      </div>
                      {!v.platform && <Badge>Yours</Badge>}
                      {active && <Check className="size-4 shrink-0" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[12.5px] text-red-600">
          {error}
        </p>
      )}

      <AddVenueDialog
        open={adding}
        initialName={q}
        onClose={() => setAdding(false)}
        onCreated={(v) => {
          setAdding(false);
          setQ("");
          onSelect(v);
        }}
      />
    </div>
  );
}

function AddVenueDialog({
  open,
  onClose,
  onCreated,
  initialName,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (v: Venue) => void;
  initialName: string;
}) {
  const create = useCreateVenue();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<VenueValues>({
    resolver: zodResolver(venueSchema),
    values: { name: initialName, addressLine: "", city: "", capacity: "" },
    resetOptions: { keepDirtyValues: true },
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const { venue } = await create.mutateAsync({
        name: v.name,
        city: v.city,
        ...(v.addressLine ? { addressLine: v.addressLine } : {}),
        ...(v.capacity ? { capacity: Number(v.capacity) } : {}),
      });
      toast.success(`${venue.name} added`);
      reset();
      onCreated(venue);
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ["name", "addressLine", "city", "capacity"]));
    }
  });

  return (
    <Dialog open={open} onClose={onClose} title="Add a venue" description="Only you can pick venues you add.">
      {/* portalled out of the step's form in the DOM, but React events still bubble to it: stop them */}
      <form onSubmit={(e) => { e.stopPropagation(); void onSubmit(e); }} noValidate className="space-y-4">
        <FormAlert message={formError} />
        <Field label="Name" placeholder="Tudikhel Hall" error={errors.name?.message} {...register("name")} />
        <Field
          label="Address"
          placeholder="Tudikhel, Kathmandu 44600"
          labelAside={<span className="text-[12px] text-muted">Optional</span>}
          error={errors.addressLine?.message}
          {...register("addressLine")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" placeholder="Kathmandu" error={errors.city?.message} {...register("city")} />
          <Field
            label="Capacity"
            inputMode="numeric"
            placeholder="500"
            labelAside={<span className="text-[12px] text-muted">Optional</span>}
            error={errors.capacity?.message}
            {...register("capacity")}
          />
        </div>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Add venue
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
