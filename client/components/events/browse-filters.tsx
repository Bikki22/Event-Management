"use client";

import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useCategories } from "@/hooks/use-events";
import { MODE_LABEL, type EventMode } from "@/lib/api/events";
import { WHEN_OPTIONS } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { BrowseState } from "./use-browse-filters";

export const CITIES = ["Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Chitwan"];

interface Props {
  state: BrowseState;
  update: (patch: Partial<BrowseState>) => void;
  clear: () => void;
  activeCount: number;
  /** category pages fix the category, so its picker is hidden */
  hideCategory?: boolean;
}

/** Search box that updates the URL 350 ms after typing stops. */
function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  // URL changed elsewhere (clear all, back button): follow it
  if (value !== synced) {
    setSynced(value);
    setText(value);
  }

  useEffect(() => {
    if (text.trim() === value) return;
    const t = window.setTimeout(() => onChange(text.trim()), 350);
    return () => window.clearTimeout(t);
  }, [text, value, onChange]);

  return (
    <div className="relative flex-1">
      <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search by event, artist or keyword"
        aria-label="Search events"
        className="h-12 w-full min-w-[240px] rounded-xl border border-line bg-card pl-11 pr-10 text-[15px] placeholder:text-ink/35 transition focus:border-ink focus:outline-none focus:shadow-[0_0_0_3px_rgb(255_90_31/0.18)]"
      />
      {text && (
        <button
          type="button"
          onClick={() => {
            setText("");
            onChange("");
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-ink"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/** Compact native select styled as a pill (good on mobile, accessible by default). */
function PillSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; indent?: boolean }[];
  placeholder: string;
}) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-12 appearance-none rounded-xl border bg-card pl-4 pr-9 text-[14px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          value ? "border-ink font-medium text-ink" : "border-line text-ink/75 hover:border-ink/30",
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.indent ? `   ${o.label}` : o.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </label>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 rounded-full border px-3.5 text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink/75 hover:border-ink/30 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function useCategoryOptions() {
  const { data } = useCategories();
  return (data ?? []).flatMap((c) => [
    { value: c.slug, label: c.name },
    ...c.children.map((s) => ({ value: s.slug, label: s.name, indent: true })),
  ]);
}

const modeOptions = (Object.keys(MODE_LABEL) as EventMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }));
const cityOptions = CITIES.map((c) => ({ value: c, label: c }));

function WhenChips({ state, update }: Pick<Props, "state" | "update">) {
  return (
    <>
      <Chip active={!state.when} onClick={() => update({ when: "" })}>
        Any time
      </Chip>
      {WHEN_OPTIONS.map((o) => (
        <Chip key={o.value} active={state.when === o.value} onClick={() => update({ when: state.when === o.value ? "" : o.value })}>
          {o.label}
        </Chip>
      ))}
    </>
  );
}

export function BrowseFilters({ state, update, clear, activeCount, hideCategory }: Props) {
  const categoryOptions = useCategoryOptions();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <SearchField value={state.q} onChange={(q) => update({ q })} />
        {/* desktop: dropdowns sit beside the search box */}
        <div className="hidden items-center gap-2 md:flex">
          {!hideCategory && (
            <PillSelect
              label="Category"
              placeholder="All categories"
              value={state.category}
              onChange={(category) => update({ category })}
              options={categoryOptions}
            />
          )}
          <PillSelect label="City" placeholder="Any city" value={state.city} onChange={(city) => update({ city })} options={cityOptions} />
          <PillSelect
            label="Event type"
            placeholder="All types"
            value={state.mode}
            onChange={(mode) => update({ mode: mode as EventMode | "" })}
            options={modeOptions}
          />
        </div>
        <Button
          variant="secondary"
          className="relative h-12 overflow-visible px-4 md:hidden"
          onClick={() => setSheetOpen(true)}
          aria-label="Filters"
        >
          <SlidersHorizontal className="size-[18px]" />
          {activeCount > 0 && (
            <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white">
              {activeCount}
            </span>
          )}
        </Button>
      </div>

      {/* desktop: date chips on their own row */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <WhenChips state={state} update={update} />
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clear}
            className="ml-auto text-[13.5px] text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* mobile: dates scroll sideways; the rest lives in a sheet */}
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] sm:-mx-8 sm:px-8 md:hidden [&::-webkit-scrollbar]:hidden">
        <WhenChips state={state} update={update} />
      </div>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filters">
        <div className="space-y-7 p-5">
          {!hideCategory && (
            <fieldset>
              <legend className="mb-3 text-[13px] font-medium">Category</legend>
              <PillSelect
                label="Category"
                placeholder="All categories"
                value={state.category}
                onChange={(category) => update({ category })}
                options={categoryOptions}
              />
            </fieldset>
          )}
          <fieldset>
            <legend className="mb-3 text-[13px] font-medium">City</legend>
            <div className="flex flex-wrap gap-2">
              <Chip active={!state.city} onClick={() => update({ city: "" })}>
                Any city
              </Chip>
              {CITIES.map((c) => (
                <Chip key={c} active={state.city === c} onClick={() => update({ city: c })}>
                  {c}
                </Chip>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-[13px] font-medium">Event type</legend>
            <div className="flex flex-wrap gap-2">
              <Chip active={!state.mode} onClick={() => update({ mode: "" })}>
                All
              </Chip>
              {modeOptions.map((m) => (
                <Chip key={m.value} active={state.mode === m.value} onClick={() => update({ mode: m.value as EventMode })}>
                  {m.label}
                </Chip>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2 border-t border-line pt-5">
            <Button variant="secondary" className="flex-1" onClick={clear} disabled={activeCount === 0}>
              Clear all
            </Button>
            <Button className="flex-1" onClick={() => setSheetOpen(false)}>
              Show events
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
