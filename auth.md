# Event Management System: Auth Module Design

> **Phase 3a: Authentication.** Builds on [`database.md`](./database.md) §4.1 and [`backend.md`](./backend.md) §5 (Auth) and §7.1 (Security).
> Scope: register, email verification, login, JWT access + rotating refresh tokens, logout, forgot/reset password, transactional email through Resend.

---

## 1. Scope

**In v1**

| #   | Feature                                   | Notes                                                     |
| --- | ----------------------------------------- | --------------------------------------------------------- |
| 1   | Register                                  | email + password + full name; sends verification email    |
| 2   | Verify email / resend verification        | single-use link, 24 h                                     |
| 3   | Login                                     | returns access token in the body, sets the refresh cookie |
| 4   | Refresh                                   | rotates the refresh token; detects reuse                  |
| 5   | Logout                                    | revokes the current session (other devices: §2 sessions)  |
| 6   | Forgot / reset password                   | single-use link, 30 min; reset revokes all sessions       |
| 7   | Change password (logged in)               | needs the current password; revokes the other sessions    |
| 8   | List / revoke sessions                    | "logged-in devices" screen                                |
| 9   | `GET /me`                                 | current user; needed to test auth end to end              |
| 10  | Emails through Resend                     | verify, reset, password changed                           |
| 11  | `authenticate` + `requireRole` middleware | used by every other module                                |

**Out of scope (later):** Google/OAuth login, 2FA/TOTP, changing email address, account deletion, breached-password (HIBP) check.

---

## 2. Endpoints

Base path `/api/v1`. Every error is problem+json (`backend.md` §4.3).

| Method | Path                        | Access    | Body                                      | Success                                                                 | Main errors                                                          |
| ------ | --------------------------- | --------- | ----------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| POST   | `/auth/register`            | 🔓        | `{ email, password, fullName, phone? }`   | `201 { user, accessToken, expiresIn }` + refresh cookie                 | `409 EMAIL_TAKEN`, `400 VALIDATION_FAILED`                           |
| POST   | `/auth/verify-email`        | 🔓        | `{ token }`                               | `200 { user }`                                                          | `400 INVALID_OR_EXPIRED_TOKEN`                                       |
| POST   | `/auth/resend-verification` | 👤        | none                                      | `202`                                                                   | `409 ALREADY_VERIFIED`, `429`                                        |
| POST   | `/auth/login`               | 🔓        | `{ email, password }`                     | `200 { user, accessToken, expiresIn }` + refresh cookie                 | `401 INVALID_CREDENTIALS`, `403 ACCOUNT_SUSPENDED`, `429`            |
| POST   | `/auth/refresh`             | 🔓 cookie | none (`X-Requested-With` header required) | `200 { accessToken, expiresIn }` + new cookie                           | `401 REFRESH_INVALID`, `401 REFRESH_REUSED`, `403 CSRF_CHECK_FAILED` |
| POST   | `/auth/logout`              | 👤        | none                                      | `204`, cookie cleared                                                   |                                                                      |
| POST   | `/auth/forgot-password`     | 🔓        | `{ email }`                               | **always** `202`                                                        | `429`                                                                |
| POST   | `/auth/reset-password`      | 🔓        | `{ token, newPassword }`                  | `204`                                                                   | `400 INVALID_OR_EXPIRED_TOKEN`                                       |
| POST   | `/auth/change-password`     | 👤        | `{ currentPassword, newPassword }`        | `204`                                                                   | `401 INVALID_CREDENTIALS`                                            |
| GET    | `/auth/sessions`            | 👤        | none                                      | `200 { data: [{ id, userAgent, ip, createdAt, lastUsedAt, current }] }` |                                                                      |
| DELETE | `/auth/sessions/{id}`       | 👤 owner  | none                                      | `204`                                                                   | `404`                                                                |
| GET    | `/me`                       | 👤        | none                                      | `200 { user }`                                                          | `401`                                                                |

`user` response shape (never includes `passwordHash`):

```json
{
  "id": "…",
  "email": "a@b.com",
  "fullName": "…",
  "phone": null,
  "role": "attendee",
  "emailVerified": false,
  "createdAt": "…"
}
```

**Behaviour decisions**

- **Register logs the user in right away.** Unverified users can browse and see their profile. Booking and becoming an organizer require `emailVerified = true` (returns `403 EMAIL_NOT_VERIFIED`).
- **Register shows `EMAIL_TAKEN`.** This reveals that an account exists, which is normal for sign-up forms. Login and forgot-password never reveal it.
- **Forgot-password** always returns `202`, with the same timing whether or not the email exists. The real work goes to the email queue.

### 2.1 Try it in Postman (copy-paste examples)

**Before you start**

- Run `docker compose up -d postgres redis mailpit`, `npm run dev` (API) and `npm run dev:worker` (sends emails) inside `server/`.
- Base URL: `http://localhost:4000/api/v1`. Every request with a body uses **Body → raw → JSON**.
- **Emails** (verify / reset links) land in Mailpit: open `http://localhost:8025`, open the email, copy the `token=...` value from the link.
- **Access token:** copy `accessToken` from the register/login response. For protected routes, go to **Authorization → Bearer Token** and paste it. It expires after 15 min; call refresh to get a new one.
- **Refresh cookie:** Postman stores the `ems_rt` cookie automatically (check **Cookies** under the Send button). Nothing to copy by hand.
- **Rate limits:** login allows 5 attempts per minute per IP. If you get `429 RATE_LIMITED`, wait for the `Retry-After` seconds.
- **Password rules:** 8–128 characters.

**Optional:** auto-save the token. On the register and login requests, open **Scripts → Post-response** and paste:

```js
const body = pm.response.json();
if (body.accessToken) pm.environment.set("accessToken", body.accessToken);
```

Then for protected routes set **Authorization → Bearer Token** to `{{accessToken}}`. Add the same script to the refresh request too.

---

#### 1. Register

`POST http://localhost:4000/api/v1/auth/register`

```json
{
  "email": "user@gmail.com",
  "password": "user1234",
  "fullName": "user",
  "phone": "9712345678"
}
```

`phone` is optional. Response `201`:

```json
{
  "user": {
    "id": "01a1af90-…",
    "email": "user@gmail.com",
    "fullName": "user",
    "phone": "9712345678",
    "role": "attendee",
    "emailVerified": false,
    "createdAt": "2026-11-06T06:33:40.384Z"
  },
  "accessToken": "eyJhbGciOiJFZERTQSIs…",
  "expiresIn": 900
}
```

More test users:

```json
{
  "email": "organizer@gmail.com",
  "password": "organizer123",
  "fullName": "Event Organizer",
  "phone": "9801234567"
}
```

```json
{ "email": "test@gmail.com", "password": "test12345", "fullName": "Test User" }
```

Error cases to try:

```json
{ "email": "user@gmail.com", "password": "user1234", "fullName": "user" }
```

→ `409 EMAIL_TAKEN` (already registered)

```json
{ "email": "not-an-email", "password": "short", "fullName": "" }
```

→ `400 VALIDATION_FAILED` with one entry per field in `errors`

```json
{
  "email": "hacker@gmail.com",
  "password": "hacker123",
  "fullName": "Hacker",
  "role": "admin"
}
```

→ `400 VALIDATION_FAILED` (`Unrecognized key: "role"`; users can't make themselves admin)

#### 2. Login

`POST http://localhost:4000/api/v1/auth/login`

```json
{
  "email": "user@gmail.com",
  "password": "user1234"
}
```

Response `200`: same shape as register (`user`, `accessToken`, `expiresIn`) and the refresh cookie is set.

Wrong password → `401 INVALID_CREDENTIALS`:

```json
{ "email": "user@gmail.com", "password": "wrongpass" }
```

#### 3. Get current user

`GET http://localhost:4000/api/v1/me`
Authorization: **Bearer Token** = `accessToken`. No body.

#### 4. Refresh access token

`POST http://localhost:4000/api/v1/auth/refresh`
No body. **Headers** tab, add:

| Key                | Value   |
| ------------------ | ------- |
| `X-Requested-With` | `fetch` |

Response `200`:

```json
{ "accessToken": "eyJhbGciOiJFZERTQSIs…", "expiresIn": 900 }
```

Without the header → `403 CSRF_CHECK_FAILED`. Without the cookie → `401 REFRESH_INVALID`.

#### 5. Verify email

`POST http://localhost:4000/api/v1/auth/verify-email`
Copy the token from the "Verify your email" message in Mailpit:

```json
{
  "token": "PASTE_TOKEN_FROM_EMAIL_LINK"
}
```

Response `200 { "user": { …, "emailVerified": true } }`. Sending the same token again → `400 INVALID_OR_EXPIRED_TOKEN`.

#### 6. Resend verification email

`POST http://localhost:4000/api/v1/auth/resend-verification`
Bearer token, no body. Response `202`. Already verified → `409 ALREADY_VERIFIED`.

#### 7. Forgot password

`POST http://localhost:4000/api/v1/auth/forgot-password`

```json
{
  "email": "user@gmail.com"
}
```

Always `202` with an empty body, even for an email that doesn't exist. Check Mailpit for "Reset your EMS password".

#### 8. Reset password

`POST http://localhost:4000/api/v1/auth/reset-password`
Copy the token from the reset email link:

```json
{
  "token": "PASTE_TOKEN_FROM_EMAIL_LINK",
  "newPassword": "newpass1234"
}
```

Response `204`. All devices are signed out, and you get a "password was changed" email. Log in again with `newpass1234`.

#### 9. Change password (while logged in)

`POST http://localhost:4000/api/v1/auth/change-password`
Bearer token:

```json
{
  "currentPassword": "user1234",
  "newPassword": "changed1234"
}
```

Response `204`. This device stays signed in and every other device is signed out. Wrong current password → `401 INVALID_CREDENTIALS`. Same old and new password → `400`.

#### 10. List my sessions (devices)

`GET http://localhost:4000/api/v1/auth/sessions`
Bearer token. Response `200`:

```json
{
  "data": [
    {
      "id": "01a1af90-1f32-7cfe-96d3-cd857c04a5a6",
      "userAgent": "PostmanRuntime/7.43.0",
      "ip": "::1",
      "createdAt": "2026-11-06T06:33:40.384Z",
      "lastUsedAt": "2026-11-06T06:40:12.001Z",
      "current": true
    }
  ]
}
```

#### 11. Sign out one device

`DELETE http://localhost:4000/api/v1/auth/sessions/PASTE_SESSION_ID`
Bearer token, `id` from the list above. Response `204`. Someone else's or an unknown id → `404`.

#### 12. Logout

`POST http://localhost:4000/api/v1/auth/logout`
Bearer token, no body. Response `204`. The same access token on `GET /me` now returns `401 SESSION_REVOKED`.

#### Suggested test order

Register → Get me → open Mailpit → Verify email → Get me (`emailVerified: true`) → Refresh → Sessions → Change password → Logout → Login with the new password → Forgot password → Reset password → Login.

---

## 3. Tokens

### 3.1 Access token (JWT)

| Item      | Value                                                                                        |
| --------- | -------------------------------------------------------------------------------------------- |
| Library   | `jose`                                                                                       |
| Algorithm | **EdDSA (Ed25519)**, `kid` header for key rotation                                           |
| Lifetime  | 15 min                                                                                       |
| Claims    | `sub` (user id), `role`, `sid` (session id), `iss`, `aud`, `iat`, `exp`, `jti`               |
| Transport | `Authorization: Bearer <token>`; the frontend keeps it **in memory only**                    |
| Keys      | PEM in env (`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`); `npm run keys:generate` creates a dev pair |

### 3.2 Refresh token (opaque)

| Item                          | Value                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Format                        | 32 random bytes, base64url                                                                 |
| Lifetime                      | 30 days (sliding: each rotation issues a new 30 days, capped at 90 days from first login)  |
| Storage (client)              | cookie `ems_rt`: `HttpOnly; Secure (prod); SameSite=Strict; Path=/api/v1/auth`             |
| Storage (server)              | only `sha256(token)` in the DB                                                             |
| CSRF guard on `/auth/refresh` | `SameSite=Strict` + required `X-Requested-With: fetch` header + `Origin` in `CORS_ORIGINS` |

### 3.3 Sessions, rotation and reuse detection

One **session** = one logged-in device. Each session has a chain of refresh tokens. This needs a small change to `database.md` §4.1:

```
auth_sessions   (id, user_id, user_agent, ip, created_at, last_used_at, expires_at, revoked_at, revoke_reason)
refresh_tokens  (id, session_id FK → auth_sessions, token_hash UNIQUE, expires_at, used_at NULL, created_at)
```

Refresh flow (one transaction, `SELECT … FOR UPDATE` on the token row):

1. Hash the cookie value and look up `refresh_tokens`. Not found / expired / session revoked → `401 REFRESH_INVALID`.
2. **`used_at` already set → reuse.** The token was stolen or replayed. Revoke the whole session (`revoke_reason = 'reuse_detected'`), log `warn`, return `401 REFRESH_REUSED`.
   - Grace window: if it was used **< 10 s ago** (two browser tabs refreshing at once), return `401 REFRESH_INVALID` without revoking. The other tab already holds the new token.
3. Otherwise set `used_at = now()`, insert the next token in the same session, update `last_used_at`, and sign a new access token with the same `sid`.

### 3.4 Logout takes effect immediately

Access tokens are stateless, so a revoked session's JWT would otherwise work for up to 15 min. On revoke we write `sess:revoked:{sid}` to Redis (TTL 15 min). `authenticate` checks that key along with the cached user status `user:status:{id}` (60 s TTL, `backend.md` §7.1). Both are single Redis `GET`s, no DB hit.

---

## 4. Passwords

- **argon2id** via `@node-rs/argon2` (m = 19 MiB, t = 2, p = 1).
- Rules: 8–128 characters (the max protects the hasher from huge inputs). No forced composition rules (NIST 800-63B).
- **Login runs in constant time:** when the email doesn't exist we still verify against a fixed dummy hash, so response timing doesn't reveal which emails are registered.
- The same generic `INVALID_CREDENTIALS` error is returned for a wrong email and a wrong password.
- Suspended users get `403 ACCOUNT_SUSPENDED` **only after** the correct password.

---

## 5. Email verification and password reset tokens

Table `verification_tokens` (`database.md` §4.1): `id, user_id, purpose, token_hash UNIQUE, expires_at, used_at, created_at`.

| Purpose          | Lifetime | Link sent                               |
| ---------------- | -------- | --------------------------------------- |
| `email_verify`   | 24 h     | `{FRONTEND_URL}/verify-email?token=…`   |
| `password_reset` | 30 min   | `{FRONTEND_URL}/reset-password?token=…` |

- 32 random bytes; only the sha256 hash is stored.
- Single-use: consumed with `UPDATE … SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`. 0 rows → `400 INVALID_OR_EXPIRED_TOKEN`.
- Issuing a new token invalidates earlier unused tokens of the same purpose.
- **Reset password** in one transaction: consume token → set new hash → revoke all sessions → queue a "password changed" email. If the user hadn't verified their email, a successful reset also marks it verified (they proved they own the inbox).

---

## 6. Email (Resend)

### 6.1 Delivery pipeline (transactional outbox, `backend.md` §8.2)

```
service transaction ──▶ INSERT notifications (status='queued')    ← same transaction as the state change
after commit        ──▶ queue.add('email', { notificationId }, { jobId: notificationId })
worker              ──▶ load row → render template → provider.send() → status='sent', sent_at
outbox.relay (10 s) ──▶ re-enqueues rows still 'queued' after 30 s (safety net)
```

The API never calls Resend directly, so a slow or down provider never slows login or sign-up.

### 6.2 Provider interface

```ts
interface EmailProvider {
  send(msg: {
    to: string;
    subject: string;
    html: string;
    text: string;
    tags?: Record<string, string>;
  }): Promise<{ id: string }>;
}
```

| `EMAIL_DRIVER` | Used in        | Behaviour                                                                                 |
| -------------- | -------------- | ----------------------------------------------------------------------------------------- |
| `resend`       | staging / prod | Resend SDK; uses the idempotency key `notification.id` so a retry never sends twice       |
| `smtp`         | local dev      | nodemailer → **Mailpit** (`localhost:1025`, UI at `:8025`); every email is caught locally |
| `console`      | tests          | logs the message; tests read the token from it                                            |

Resend 4xx errors (bad address, domain not verified) throw `UnrecoverableError` so they aren't retried. 5xx and 429 errors retry with backoff.

### 6.3 Templates (v1)

| Type                    | Trigger                                                 |
| ----------------------- | ------------------------------------------------------- |
| `auth.verify_email`     | register, resend-verification                           |
| `auth.password_reset`   | forgot-password                                         |
| `auth.password_changed` | reset-password, change-password ("if this wasn't you…") |

Plain TypeScript functions returning `{ subject, html, text }`. We can move to React Email later without changing the interface.

---

## 7. Rate limits (Redis store, shared by all replicas)

| Endpoint                                     | Limit                                               |
| -------------------------------------------- | --------------------------------------------------- |
| `/auth/login`                                | 5 / min per IP **and** 5 / min, 20 / hour per email |
| `/auth/register`                             | 5 / min per IP                                      |
| `/auth/forgot-password`                      | 3 / hour per email, 10 / hour per IP                |
| `/auth/resend-verification`                  | 3 / hour per user                                   |
| `/auth/refresh`                              | 30 / min per IP                                     |
| `/auth/reset-password`, `/auth/verify-email` | 10 / min per IP                                     |

Auth limiters **fail closed** if Redis is down (`backend.md` §12).

---

## 8. Middleware

```ts
authenticate; // Bearer JWT → verify sig/iss/aud/exp → check Redis revoked-session + user status → req.auth = { userId, role, sessionId }
optionalAuth; // same, but anonymous is allowed (public pages that show more when logged in)
requireRole(...roles);
requireVerifiedEmail;
```

`authenticate` also calls `setUserId()`, so every log line for the request carries `userId`.

---

## 9. Logging and audit

- `info` events: `auth.registered`, `auth.login`, `auth.logout`, `auth.password_reset`, `auth.email_verified`.
- `warn`: failed login (with masked email), refresh reuse detected, rate limit hit, CSRF check failed.
- Passwords, tokens and cookies are already redacted by the pino config.
- `audit_logs` rows for password reset and password change.

---

## 10. New configuration

```
JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, JWT_KEY_ID, JWT_ISSUER=ems-api, JWT_AUDIENCE=ems-web
ACCESS_TOKEN_TTL_SECONDS=900, REFRESH_TOKEN_TTL_DAYS=30, SESSION_MAX_DAYS=90
EMAIL_VERIFY_TTL_HOURS=24, PASSWORD_RESET_TTL_MINUTES=30, APP_NAME=EMS
EMAIL_DRIVER=smtp|resend|console, EMAIL_FROM="EMS <no-reply@yourdomain.com>"
RESEND_API_KEY, SMTP_URL=smtp://localhost:1025
REDIS_URL (already present)
```

---

## 11. Files to add

```
src/lib/prisma.ts  redis.ts  queue.ts  crypto.ts           # infra the auth module needs
src/middleware/auth.ts  rate-limit.ts
src/modules/auth/
  auth.routes.ts  auth.schemas.ts  auth.service.ts  auth.repository.ts
  tokens.ts            # sign/verify JWT, issue/rotate refresh tokens
  password.ts          # argon2 hash/verify + dummy hash
  cookies.ts           # set/clear refresh cookie
  auth.test.ts
src/modules/users/users.routes.ts  users.service.ts  users.schemas.ts   # GET /me
src/modules/notifications/
  email/provider.ts  resend.provider.ts  smtp.provider.ts  console.provider.ts
  templates/verify-email.ts  password-reset.ts  password-changed.ts
  notifications.service.ts  notifications.jobs.ts
src/worker.ts  src/scheduler.ts
scripts/generate-keys.ts
prisma/schema.prisma (users, auth_sessions, refresh_tokens, verification_tokens, notifications, audit_logs)
```

New packages: `@prisma/client`, `prisma`, `@prisma/adapter-pg`, `pg`, `ioredis`, `bullmq`, `jose`, `@node-rs/argon2`, `resend`, `nodemailer`, `rate-limit-redis`, `vitest`, `@testcontainers/postgresql`, `@testcontainers/redis`, `supertest`.

---

## 12. Build order

1. Prisma setup + the auth tables + first migration; Redis client; queue registry.
2. `crypto.ts`, `password.ts`, `tokens.ts` (unit-tested).
3. Register, login, `GET /me`, `authenticate` middleware.
4. Refresh rotation + reuse detection, logout, logout-all, sessions list/revoke.
5. Notifications outbox + worker + providers (Mailpit locally) → verify-email and resend-verification.
6. Forgot/reset password, change password, password-changed email.
7. Redis rate limits on auth routes.
8. Integration tests: full flows, refresh reuse, expired/used tokens, rate limits, suspended user.

## 13. Implementation notes

- **Status: implemented** (`server/src/modules/auth`, `users`, `notifications`; tests in `server/test/auth.test.ts`, 27 passing).
- Repeatable jobs (outbox relay every 10 s, daily auth-data purge at 03:00) are registered by `worker.ts`; no separate scheduler process yet.
- Integration tests use the docker-compose Postgres (`ems_test` database, created and migrated automatically) and Redis DB 1, instead of Testcontainers. Signing keys are generated per test run.
- `logout-all` was dropped from the endpoint list; users sign out other devices via `DELETE /auth/sessions/{id}`, and password reset/change revoke sessions automatically.
- Hand-written migration SQL: `citext` extension, `expires_at > created_at` CHECKs, partial indexes for active sessions, queued notifications and unused tokens.

## 14. Acceptance checks

- A stolen refresh token used after the real user refreshed revokes that session; the attacker and the user both have to log in again.
- After logout, the old access token is rejected immediately (not 15 min later).
- Forgot-password responses are identical for existing and unknown emails.
- Reset and verify links work exactly once and fail after expiry.
- No password, token or cookie value appears in any log line.
- Killing the worker mid-send doesn't lose or duplicate an email.
