import { z } from "zod";

const coordinate = (min: number, max: number) => z.number().min(min).max(max);

const fields = {
  name: z.string().trim().min(2).max(120),
  addressLine: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(80),
  country: z.string().trim().min(2).max(80),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
  capacity: z.number().int().min(1).max(1_000_000),
};

const bothOrNeither = (v: { latitude?: number | null; longitude?: number | null }) =>
  (v.latitude === undefined) === (v.longitude === undefined) &&
  (v.latitude === null) === (v.longitude === null);

export const createVenueBody = z
  .object({
    name: fields.name,
    addressLine: fields.addressLine.optional(),
    city: fields.city,
    country: fields.country.optional(), // default Nepal
    latitude: fields.latitude.optional(),
    longitude: fields.longitude.optional(),
    capacity: fields.capacity.optional(),
    // admins only: a shared venue any organizer can use
    platform: z.boolean().optional(),
  })
  .strict()
  .refine(bothOrNeither, { path: ["longitude"], error: "Send latitude and longitude together" });

export const updateVenueBody = z
  .object({
    name: fields.name.optional(),
    addressLine: fields.addressLine.nullable().optional(),
    city: fields.city.optional(),
    country: fields.country.optional(),
    latitude: fields.latitude.nullable().optional(),
    longitude: fields.longitude.nullable().optional(),
    capacity: fields.capacity.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: "Provide at least one field to update" })
  .refine(bothOrNeither, { path: ["longitude"], error: "Send latitude and longitude together" });

export const listVenuesQuery = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    mine: z.stringbool().optional(), // only my own venues
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const venueIdParams = z.object({ id: z.uuid() });

export type CreateVenueBody = z.infer<typeof createVenueBody>;
export type UpdateVenueBody = z.infer<typeof updateVenueBody>;
export type ListVenuesQuery = z.infer<typeof listVenuesQuery>;
