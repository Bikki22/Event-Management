import { randomInt } from "node:crypto";

// Crockford-style alphabet: no I, L, O, U, so codes are easy to read aloud and type.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Cryptographically random code of `length` chars (5 bits each). */
export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Order reference shown to users, e.g. EVT-7K3Q9P2M (40 bits). */
export const newBookingCode = () => `EVT-${randomCode(8)}`;

/** Admission code encoded in the QR, e.g. TKT-… (80 bits: unguessable). */
export const newTicketCode = () => `TKT-${randomCode(16)}`;
