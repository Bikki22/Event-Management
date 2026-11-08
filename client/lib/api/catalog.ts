import { api } from "./client";
import type { EventCard } from "./events";

// Categories and public organizer profiles.

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
}

export interface CategoryNode extends Category {
  children: Category[];
}

export interface CategoryDetail extends Category {
  parent?: Category | null;
  children: Category[];
}

export interface PublicOrganizer {
  orgName: string;
  slug: string;
  bio: string | null;
  logoUrl: string | null;
  website: string | null;
  verified: boolean;
  memberSince: string;
}

export const catalogApi = {
  categories: () => api<{ data: CategoryNode[] }>("/categories", { auth: false }),
  category: (slug: string) => api<{ category: CategoryDetail }>(`/categories/${encodeURIComponent(slug)}`, { auth: false }),
  organizer: (slug: string) =>
    api<{ organizer: PublicOrganizer; upcomingEvents: EventCard[] }>(`/organizers/${encodeURIComponent(slug)}`, {
      auth: false,
    }),
};
