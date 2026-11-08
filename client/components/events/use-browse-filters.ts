"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { EventMode } from "@/lib/api/events";
import type { ListFilters } from "@/hooks/use-events";
import { isWhenPreset, type WhenPreset } from "@/lib/dates";

export interface BrowseState {
  q: string;
  category: string;
  city: string;
  mode: EventMode | "";
  when: WhenPreset | "";
}

const MODES: EventMode[] = ["in_person", "online", "hybrid"];
const KEYS = ["q", "category", "city", "mode", "when"] as const;

/**
 * Browse filters live in the URL (`/events?category=music&when=weekend`) so results can be
 * shared and the back button works. Uses replace, so typing doesn't flood history.
 */
export function useBrowseFilters(lockedCategory?: string) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const state: BrowseState = useMemo(() => {
    const mode = params.get("mode");
    const when = params.get("when");
    return {
      q: params.get("q") ?? "",
      category: lockedCategory ?? params.get("category") ?? "",
      city: params.get("city") ?? "",
      mode: MODES.includes(mode as EventMode) ? (mode as EventMode) : "",
      when: isWhenPreset(when) ? when : "",
    };
  }, [params, lockedCategory]);

  const update = useCallback(
    (patch: Partial<BrowseState>) => {
      const next = new URLSearchParams(params.toString());
      for (const key of KEYS) {
        if (!(key in patch)) continue;
        const value = patch[key];
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (lockedCategory) next.delete("category");
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router, lockedCategory],
  );

  const clear = useCallback(() => router.replace(pathname, { scroll: false }), [pathname, router]);

  /** What the list query gets; the date preset becomes concrete from/to at fetch time. */
  const apiFilters: ListFilters = useMemo(
    () => ({
      q: state.q || undefined,
      category: state.category || undefined,
      city: state.city || undefined,
      mode: state.mode || undefined,
      when: state.when || undefined,
      limit: 12,
    }),
    [state],
  );

  const activeCount = [state.q, lockedCategory ? "" : state.category, state.city, state.mode, state.when].filter(Boolean).length;

  return { state, update, clear, apiFilters, activeCount };
}
