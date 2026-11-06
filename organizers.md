# Organizers module

Any user with a **verified email** can become an organizer. Their profile starts as `pending`, an admin verifies or rejects it, and verified organizers get a public page with a badge. Payout details (eSewa, Khalti or bank) are stored **encrypted**.

## 1. Endpoints

| Method | Path                                      | Access            | Notes                                                   |
| ------ | ----------------------------------------- | ----------------- | ------------------------------------------------------- |
| POST   | `/me/organizer-profile`                   | 👤 verified email | Become an organizer. `403 EMAIL_NOT_VERIFIED` otherwise |
| GET    | `/me/organizer-profile`                   | 👤                | Own profile incl. review status, note and masked payout |
| PATCH  | `/me/organizer-profile`                   | 👤                | `orgName`, `slug`, `bio`, `website`, `logoUrl`          |
| PUT    | `/me/organizer-profile/payout`            | 👤                | Set/replace payout details (encrypted)                  |
| DELETE | `/me/organizer-profile/payout`            | 👤                | Remove payout details                                   |
| GET    | `/organizers/{slug}`                      | 🔓                | Public page (no payout, no review note)                 |
| GET    | `/admin/organizers`                       | 🛡️                | Filters: `status`, `q`; cursor pagination               |
| GET    | `/admin/organizers/{userId}`              | 🛡️                | Profile + owner                                         |
| PATCH  | `/admin/organizers/{userId}/verification` | 🛡️                | `{ status: verified \| rejected, note }`                |

## 2. Rules

**Becoming an organizer**

- Creates the profile with `verificationStatus: "pending"` and changes the user's role from `attendee` to `organizer` (an `admin` stays admin). The new role applies on the next request, no re-login needed.
- One profile per user: `409 ALREADY_ORGANIZER`.
- **Slug** (public URL `/organizers/{slug}`): generated from `orgName` if omitted. If that slug is taken, a random suffix is added (`kathmandu-live-3fa9c1`). Non-latin names (e.g. Devanagari) get `organizer-xxxxxx`. A slug you **choose** that is taken → `409 SLUG_TAKEN`.

**Verification**

- Admin rejects → a `note` is required, and the organizer gets an email with the reason.
- Admin verifies → the organizer gets an email, and the public page shows `verified: true`.
- Organizer edits a **rejected** profile → it goes back to `pending` automatically (resubmission).
- Organizer **renames** a **verified** organization → back to `pending` (a verified badge can't be carried over to a different name). Editing bio, website, logo or slug keeps it verified.
- Every change is in `audit_logs` (`organizer.profile_created/updated`, `organizer.payout_updated/removed`, `admin.organizer_verified/rejected`).

**Public page** hides rejected organizers and organizers whose account is suspended or deleted (`404`). Pending organizers are visible with `verified: false`. Upcoming events will be added here when the events module exists.

**Payout details**

- Encrypted with AES-256-GCM using `DATA_ENCRYPTION_KEY` before they reach the database. The key id is stored next to the ciphertext so the key can be rotated (old keys go in `DATA_ENCRYPTION_OLD_KEYS`). Each ciphertext is bound to its user id, so copying it to another row doesn't decrypt.
- The API only returns them **masked**: `98******78`, `**********0123`. They're never logged or written to the audit log.
- eSewa/Khalti: `walletId` is the 10-digit Nepali mobile number (`98…`, `97…`, `96…`).

## 3. Setup

`DATA_ENCRYPTION_KEY` was added to `server/.env` for you. **Restart `npm run dev`** so it's picked up (`tsx watch` doesn't reload `.env`). For a fresh checkout, `npm run keys:generate -- --write` creates it.

> Don't change `DATA_ENCRYPTION_KEY` once real payout data exists, or it can't be decrypted. To rotate: move the current one into `DATA_ENCRYPTION_OLD_KEYS` as `k1:<hex>`, then set a new key with a new `DATA_ENCRYPTION_KEY_ID`.

## 4. Try it in Postman

Base URL `http://localhost:3000/api/v1`, Bearer token of the user (see `auth.md` §2.1).

**Step 0: verify the email first.** Register, open Mailpit (`http://localhost:8025`), copy the token from the link and `POST /auth/verify-email` with `{ "token": "…" }`. Otherwise you get `403 EMAIL_NOT_VERIFIED`.

#### Become an organizer

`POST http://localhost:3000/api/v1/me/organizer-profile`

```json
{
  "orgName": "Kathmandu Live Events",
  "bio": "We organise concerts and comedy nights in Kathmandu.",
  "website": "https://kathmandulive.com"
}
```

With your own slug and a logo:

```json
{
  "orgName": "Pokhara Music Fest",
  "slug": "pokhara-fest",
  "logoUrl": "https://picsum.photos/200"
}
```

#### View / edit my profile

`GET http://localhost:3000/api/v1/me/organizer-profile`

`PATCH http://localhost:3000/api/v1/me/organizer-profile`

```json
{
  "bio": "Live music every Friday in Thamel.",
  "website": "https://ktmlive.com"
}
```

Remove the website:

```json
{ "website": null }
```

#### Payout details

`PUT http://localhost:3000/api/v1/me/organizer-profile/payout`

eSewa:

```json
{ "method": "esewa", "walletId": "9812345678", "accountName": "Ram Sharma" }
```

Khalti:

```json
{ "method": "khalti", "walletId": "9801234567", "accountName": "Ram Sharma" }
```

Bank:

```json
{
  "method": "bank",
  "bankName": "Nabil Bank",
  "branch": "Thamel",
  "accountName": "Kathmandu Live Events Pvt Ltd",
  "accountNumber": "01234567890123"
}
```

Response shows it masked:

```json
{
  "payout": {
    "method": "esewa",
    "accountName": "Ram Sharma",
    "walletId": "98******78"
  }
}
```

`DELETE http://localhost:3000/api/v1/me/organizer-profile/payout` → `204`.

#### Public page (no token)

`GET http://localhost:3000/api/v1/organizers/kathmandu-live-events`

#### Admin: review organizers (admin token, see `users.md` §2)

```
GET http://localhost:3000/api/v1/admin/organizers
GET http://localhost:3000/api/v1/admin/organizers?status=pending
GET http://localhost:3000/api/v1/admin/organizers?q=kathmandu
GET http://localhost:3000/api/v1/admin/organizers/{userId}
```

`PATCH http://localhost:3000/api/v1/admin/organizers/{userId}/verification`

Verify:

```json
{ "status": "verified" }
```

Reject (note required):

```json
{
  "status": "rejected",
  "note": "Please add your company registration details to the bio."
}
```

The organizer's email shows up in Mailpit.

#### Errors to try

| Request                                                                          | Result                   |
| -------------------------------------------------------------------------------- | ------------------------ |
| `POST` with an unverified user                                                   | `403 EMAIL_NOT_VERIFIED` |
| `POST` a second time                                                             | `409 ALREADY_ORGANIZER`  |
| `POST` `{ "orgName": "X", "slug": "kathmandu-live-events" }` (taken)             | `409 SLUG_TAKEN`         |
| `PATCH` `{ "verificationStatus": "verified" }`                                   | `400 VALIDATION_FAILED`  |
| `PUT /payout` `{ "method": "esewa", "walletId": "12345", "accountName": "Ram" }` | `400`                    |
| Admin reject without `note`                                                      | `400 VALIDATION_FAILED`  |

## 5. Files

```
prisma/migrations/…_organizer_profiles/migration.sql   # table + CHECKs (slug, payout method, rejection note)
src/lib/encryption.ts                                  # AES-256-GCM encryptJson/decryptJson with key ids
src/modules/organizers/organizers.schemas.ts           # Zod bodies (payout = discriminated union per method)
src/modules/organizers/organizers.dto.ts               # owner / public / admin views, payout masking
src/modules/organizers/organizers.repository.ts
src/modules/organizers/organizers.service.ts           # become organizer, edits, payout, review + emails
src/modules/organizers/organizers.routes.ts            # /me/organizer-profile, /organizers, /admin/organizers
src/modules/notifications/templates/index.ts           # + organizer.verified / organizer.rejected emails
test/organizers.test.ts                                # 14 tests
```

**Open decision for the events module:** can a `pending` organizer create draft events, or only `verified` ones? Suggested: drafts allowed, **publishing** requires `verified`.
