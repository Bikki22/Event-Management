import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { API_URL } from "@/lib/api/config";
import type { CategoryDetail, PublicOrganizer } from "@/lib/api/catalog";
import type { EventCard, PublicEvent } from "@/lib/api/events";

/**
 * Cached server-side reads for public, shareable pages (event, organizer, category), so they
 * render with real content for SEO and link previews. Live data (seats left) is refreshed on
 * the client. `null` means 404; other failures throw and hit the error boundary.
 */
async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export async function getPublicEvent(slug: string): Promise<PublicEvent | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`event:${slug}`);
  const data = await getJson<{ event: PublicEvent }>(`/events/${encodeURIComponent(slug)}`);
  return data?.event ?? null;
}

export async function getPublicOrganizer(
  slug: string,
): Promise<{ organizer: PublicOrganizer; upcomingEvents: EventCard[] } | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`organizer:${slug}`);
  return getJson(`/organizers/${encodeURIComponent(slug)}`);
}

export async function getCategory(slug: string): Promise<CategoryDetail | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("categories");
  const data = await getJson<{ category: CategoryDetail }>(`/categories/${encodeURIComponent(slug)}`);
  return data?.category ?? null;
}
