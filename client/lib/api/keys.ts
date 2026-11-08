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
    events: (filter: Record<string, unknown> = {}) => [...keys.me.all, "events", filter] as const,
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
  /** Organizer dashboard: one event's manage view and everything under it. */
  manage: {
    all: ["manage"] as const,
    event: (id: string) => [...keys.manage.all, "event", id] as const,
    venues: (filter: Record<string, unknown>) => [...keys.manage.all, "venues", filter] as const,
    promoCodes: (id: string) => [...keys.manage.all, "event", id, "promo-codes"] as const,
    attendees: (id: string, filter: Record<string, unknown> = {}) =>
      [...keys.manage.all, "event", id, "attendees", filter] as const,
    staff: (id: string) => [...keys.manage.all, "event", id, "staff"] as const,
    checkIns: (id: string) => [...keys.manage.all, "event", id, "check-ins"] as const,
  },
};
