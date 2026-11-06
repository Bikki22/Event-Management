# Users module

Profile endpoints for the signed-in user, plus admin user management.
Organizer profiles (`/me/organizer-profile`, `/organizers/{slug}`) live in the separate **organizers** module.

## 1. Endpoints

| Method | Path                | Access | Notes                                                              |
| ------ | ------------------- | ------ | ------------------------------------------------------------------ |
| GET    | `/me`               | 👤     | Current user                                                       |
| PATCH  | `/me`               | 👤     | `fullName`, `phone` only. `phone: null` clears it                  |
| GET    | `/admin/users`      | 🛡️     | Newest first, cursor pagination. Filters: `q`, `role`, `status`    |
| GET    | `/admin/users/{id}` | 🛡️     | Includes `status`, `lastLoginAt`, `activeSessions`                 |
| PATCH  | `/admin/users/{id}` | 🛡️     | `role` and/or `status` (`active` / `suspended`). Audited           |

Rules:

- `PATCH /me` rejects any other field (`email`, `role`, `emailVerified`, …) with `400 VALIDATION_FAILED`. Email change needs a re-verification flow and is not built yet.
- All `/admin/*` routes check `authenticate` + `requireRole("admin")` once, at router level (`src/modules/admin/admin.routes.ts`).
- **Suspending** a user revokes all their sessions in the same transaction, so their access token stops working immediately and login returns `403 ACCOUNT_SUSPENDED`.
- **Role changes** apply on the user's next request (the cached auth state in Redis is dropped).
- An admin can't change their own role or status (`403 CANNOT_MODIFY_SELF`), so nobody locks themselves out.
- Every admin change writes an `audit_logs` row (`admin.user_updated`) with the before/after values.

## 2. Creating the first admin

There is no API to create an admin. Register a normal account, then run:

```bash
cd server
npm run user:make-admin -- admin@gmail.com
```

Sign in again (or wait up to 60 s) and the account has admin access.

## 3. Try it in Postman

Base URL: `http://localhost:4000/api/v1`. For every request below, set **Authorization → Bearer Token** to the `accessToken` from login (or `{{accessToken}}` if you use the script from `auth.md` §2.1).

#### Update my profile

`PATCH http://localhost:4000/api/v1/me`

```json
{
  "fullName": "user updated",
  "phone": "9812345678"
}
```

Only one field is fine too:

```json
{ "fullName": "user" }
```

Remove the phone number:

```json
{ "phone": null }
```

These fail with `400 VALIDATION_FAILED`:

```json
{ "role": "admin" }
```

```json
{ "email": "new@gmail.com" }
```

```json
{}
```

#### Admin: list users

First make an admin (§2), log in as them and use their token.

```
GET http://localhost:4000/api/v1/admin/users
GET http://localhost:4000/api/v1/admin/users?limit=2
GET http://localhost:4000/api/v1/admin/users?q=gmail
GET http://localhost:4000/api/v1/admin/users?role=organizer
GET http://localhost:4000/api/v1/admin/users?status=suspended
```

Response:

```json
{
  "data": [ { "id": "…", "email": "user@gmail.com", "role": "attendee", "status": "active", "…": "…" } ],
  "page": { "nextCursor": "eyJpZCI6…", "hasMore": true, "limit": 2 }
}
```

Next page: copy `nextCursor` into `?limit=2&cursor=eyJpZCI6…`.

#### Admin: get one user

`GET http://localhost:4000/api/v1/admin/users/{id}` (copy an `id` from the list)

#### Admin: suspend / reactivate / change role

`PATCH http://localhost:4000/api/v1/admin/users/{id}`

```json
{ "status": "suspended" }
```

```json
{ "status": "active" }
```

```json
{ "role": "admin" }
```

```json
{ "role": "attendee", "status": "active" }
```

After suspending, try `GET /me` with that user's old token: `401 SESSION_REVOKED`. Logging in as them: `403 ACCOUNT_SUSPENDED`.

## 4. Files

```
src/modules/users/users.schemas.ts     # Zod: updateMeBody, admin query/body (fullName/phone rules shared with auth)
src/modules/users/users.dto.ts         # UserDto (public), AdminUserDto (+ status, lastLoginAt)
src/modules/users/users.repository.ts  # Prisma calls, keyset list query
src/modules/users/users.service.ts     # getMe, updateMe, adminList/Get/UpdateUser
src/modules/users/users.routes.ts      # meRouter (/me), adminUsersRouter (/admin/users)
src/modules/admin/admin.routes.ts      # /admin: authenticate + requireRole("admin")
src/lib/pagination.ts                  # cursor encode/decode + page envelope
src/lib/audit.ts                       # writeAudit (moved from auth.repository)
scripts/make-admin.ts                  # npm run user:make-admin -- <email>
test/users.test.ts                     # 9 integration tests
```
