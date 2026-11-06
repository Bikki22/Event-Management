import type { Venue } from "../../generated/prisma/client.js";

export interface VenueDto {
  id: string;
  name: string;
  addressLine: string | null;
  city: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  capacity: number | null;
  hasSeatMap: boolean;
  /** true = shared platform venue, false = owned by an organizer */
  platform: boolean;
}

export const toVenueDto = (v: Venue): VenueDto => ({
  id: v.id,
  name: v.name,
  addressLine: v.addressLine,
  city: v.city,
  country: v.country,
  latitude: v.latitude === null ? null : Number(v.latitude),
  longitude: v.longitude === null ? null : Number(v.longitude),
  capacity: v.capacity,
  hasSeatMap: v.hasSeatMap,
  platform: v.ownerId === null,
});
