/**
 * Query keys in one place, so invalidation stays consistent:
 *   queryClient.invalidateQueries({ queryKey: keys.me.all })
 * Keys are nested arrays: invalidating a prefix invalidates everything under it.
 */
export const keys = {
  me: {
    all: ["me"] as const,
    profile: () => [...keys.me.all, "profile"] as const,
    sessions: () => [...keys.me.all, "sessions"] as const,
    bookings: (filter: Record<string, unknown> = {}) => [...keys.me.all, "bookings", filter] as const,
    tickets: (filter: Record<string, unknown> = {}) => [...keys.me.all, "tickets", filter] as const,
    events: () => [...keys.me.all, "events"] as const,
    organizerProfile: () => [...keys.me.all, "organizer-profile"] as const,
  },
  categories: {
    all: ["categories"] as const,
    detail: (slug: string) => [...keys.categories.all, slug] as const,
  },
  events: {
    all: ["events"] as const,
    list: (filters: Record<string, unknown>) => [...keys.events.all, "list", filters] as const,
    detail: (idOrSlug: string) => [...keys.events.all, "detail", idOrSlug] as const,
    availability: (id: string) => [...keys.events.all, "availability", id] as const,
  },
  bookings: {
    detail: (id: string) => ["bookings", id] as const,
  },
  tickets: {
    detail: (id: string) => ["tickets", id] as const,
  },
  organizers: {
    detail: (slug: string) => ["organizers", slug] as const,
  },
};
