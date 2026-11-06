# Event Management System: Backend Design

> **Phase 2: Backend (REST API) design.** Builds directly on [`database.md`](./database.md) (PostgreSQL schema, inventory model, state machines).
> Scope: architecture, API contract, security, performance, reliability, queues, logging (pino), observability and Docker.

---

## 0. Goals and non-goals

**Goals**

1. **Correctness under concurrency.** Never oversell, never double-book a seat, never confirm a booking without a verified payment. The database enforces this (see `database.md` 6§); the backend must never work around it.
2. **Horizontally scalable.** API processes are stateless, so we can run 1 or 20 replicas behind a load balancer without code changes.
3. **Reliable side effects.** Emails, ticket PDFs, refunds and webhook processing survive crashes and restarts (outbox + queues + idempotency).
4. **Secure by default.** OWASP API Top 10 covered, least privilege, secrets out of code, PII out of logs.
5. **Observable.** Every request and job is traceable with structured JSON logs (pino), metrics and traces.
6. **Simple to run.** `docker compose up` gives a full local stack.

**Non-goals (v1)**

- Microservices. We build a **modular monolith**: one codebase, two process types (`api`, `worker`), strict module boundaries. It can be split later if a module needs independent scaling.
- GraphQL, gRPC, WebSockets. REST + JSON only. (Live seat-map updates can be added later via SSE.)
- Kubernetes. Docker Compose for dev and a single-host deploy; the images are K8s-ready when needed.

---

## 1. Tech stack

| Concern                           | Choice                                                          | Why                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                           | **Node.js 24 LTS** + **TypeScript** (strict)                    | Matches the team's JS skills; strong typing across API ↔ DB                                                                        |
| HTTP framework                    | **Express 5**                                                   | Most widely known Node framework, huge middleware ecosystem, native async error handling in v5; logging via `pino-http`             |
| Validation                        | **Zod** + a small `validate({ body, query, params })` middleware | One schema gives runtime validation, TS types and OpenAPI docs                                                                     |
| Database                          | **PostgreSQL 18**                                               | See `database.md` (native `uuidv7()` in PG 18)                                                                                     |
| DB access                         | **Prisma ORM 7** (`prisma-client` generator + `@prisma/adapter-pg` driver adapter) + `$queryRaw` / TypedSQL for hot paths | Best DX, fully typed client, relations and nested writes; inventory/seat/check-in queries stay hand-written SQL (see §3.1) |
| Migrations                        | `prisma migrate` (versioned SQL files in `prisma/migrations/`, hand-edited for CHECKs/partial indexes) | Reviewable, reproducible; `migrate deploy` in prod                                                                  |
| Connection pooling                | `pg` pool in-app + **PgBouncer** (transaction mode) in prod     | Many API replicas × pool size can't exceed Postgres `max_connections`                                                              |
| Cache / rate limit / queue broker | **Redis 8**                                                     | One dependency covers three needs                                                                                                  |
| Queues                            | **BullMQ**                                                      | Redis-backed, retries with backoff, delayed and repeatable jobs, rate-limited queues, good TS support                              |
| Logging                           | **pino** (+ `pino-pretty` in dev only)                          | Fastest Node logger, JSON output, redaction, child loggers                                                                         |
| Metrics                           | `prom-client` → Prometheus / Grafana                            | Standard                                                                                                                           |
| Tracing                           | OpenTelemetry SDK (auto-instrument http, ioredis) + `@prisma/instrumentation` | Follows a request from API → DB → queue → worker                                                                                   |
| Auth                              | JWT (access) via `jose` + opaque rotating refresh tokens        | Stateless access checks, revocable sessions                                                                                        |
| Password hashing                  | **argon2id** (`@node-rs/argon2`)                                | Current OWASP recommendation                                                                                                       |
| File storage                      | S3-compatible (AWS S3 / Cloudflare R2; **MinIO** locally)       | Images never touch the API process (presigned uploads)                                                                             |
| Email                             | Provider API (Resend / SES / Postmark) behind an interface      | Swappable; Mailpit locally                                                                                                         |
| API docs                          | OpenAPI 3.1 generated from Zod (`@asteasolutions/zod-to-openapi` + `@scalar/express-api-reference`) | Docs can't drift from code                                                                                                         |
| Testing                           | Vitest + **Testcontainers** (real Postgres/Redis) + k6 for load | Test against the real DB constraints that guarantee correctness                                                                    |
| Lint/format                       | ESLint (typescript-eslint) + Prettier                           |                                                                                                                                    |
| Containers                        | Docker (multi-stage), Docker Compose                            |                                                                                                                                    |

> **HTTP middleware stack:** Express 5 + `pino-http` (request logging) + `helmet` + `cors` + `express-rate-limit` (with `rate-limit-redis`) + `cookie-parser`.

---

## 2. Architecture overview

```mermaid
flowchart LR
    subgraph Clients
        WEB[Web app]
        MOB[Mobile / Scanner app]
    end

    WEB & MOB -->|HTTPS| LB[Reverse proxy / LB<br/>Nginx or Caddy<br/>TLS, gzip, body limit]

    LB --> API1[API replica 1]
    LB --> API2[API replica N]

    subgraph App["Modular monolith (same image)"]
        API1
        API2
        W1[Worker process(es)]
        SCHED[Scheduler<br/>repeatable jobs]
    end

    API1 & API2 -->|SQL| PGB[PgBouncer]
    W1 --> PGB
    PGB --> PG[(PostgreSQL primary)]
    PG -.replication.-> PGR[(Read replica<br/>reports, listings)]

    API1 & API2 -->|cache, rate limit, enqueue| R[(Redis)]
    W1 -->|consume| R
    SCHED --> R

    API1 & API2 -->|presigned URLs| S3[(Object storage)]
    W1 --> S3
    W1 --> MAIL[Email / SMS provider]
    API1 & API2 -->|verify payment| PAY[eSewa / Khalti / Stripe]
    PAY -->|webhooks / callbacks| LB
    W1 --> PAY

    API1 & API2 & W1 -->|JSON logs stdout| LOGS[Log collector<br/>Loki / Grafana / Datadog]
```

**Process types (same Docker image, different command):**

| Process     | Command                                         | Scales by                 | Responsibility                                                                                                                                                                                      |
| ----------- | ----------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`       | `node dist/server.js`                           | CPU / request rate        | HTTP only. Validates, authorizes, runs short DB transactions, enqueues jobs. **Never** sends email or calls slow third parties inline (except payment verification, which the user is waiting for). |
| `worker`    | `node dist/worker.js`                           | Queue depth / job latency | Consumes BullMQ queues: emails, ticket PDFs, webhook processing, refunds, fan-outs.                                                                                                                 |
| `scheduler` | `node dist/scheduler.js` (or inside one worker) | Exactly **1** active      | Registers repeatable jobs: booking expiry, outbox relay sweep, event auto-complete, cleanup. BullMQ dedupes repeatable jobs, so running 2 is safe but wasteful.                                     |

**Statelessness rules for `api`:**

- No in-memory sessions, caches that must be consistent, or local file writes.
- All shared state lives in Postgres (truth) or Redis (ephemeral).
- Any replica can serve any request, which allows rolling deploys and autoscaling.

---

## 3. Project structure

Feature-first modules with a layered inside. Cross-module calls go through the other module's **service**, never its repository or tables directly.

```
backend/
├── src/
│   ├── server.ts                 # boots API: config → logger → db → redis → app.listen
│   ├── worker.ts                 # boots BullMQ workers
│   ├── scheduler.ts              # registers repeatable jobs
│   ├── app.ts                    # buildApp(): registers middleware + module routers (used by tests too)
│   │
│   ├── config/
│   │   └── env.ts                # Zod-validated env; process exits on invalid config
│   │
│   ├── lib/                      # framework-agnostic infrastructure
│   │   ├── logger.ts             # pino root logger + redaction
│   │   ├── context.ts            # AsyncLocalStorage request/job context
│   │   ├── prisma.ts             # PrismaClient singleton (pg adapter) + logging/slow-query extension
│   │   ├── redis.ts              # ioredis clients (cache, bullmq)
│   │   ├── queue.ts              # queue registry, default job options
│   │   ├── errors.ts             # AppError hierarchy + PG error mapping
│   │   ├── crypto.ts             # token generation, hashing, HMAC helpers
│   │   ├── money.ts              # minor-unit helpers (never floats)
│   │   ├── cache.ts              # get-or-set with stampede protection
│   │   └── http-client.ts        # undici with timeouts, retries, circuit breaker
│   │
│   ├── middleware/               # Express middleware (cross-cutting)
│   │   ├── security.ts           # helmet, cors, rate-limit
│   │   ├── auth.ts               # authenticate middleware, requireRole, requireOwnership
│   │   ├── request-context.ts    # request id → ALS, response header
│   │   ├── error-handler.ts      # AppError/Zod/PG → problem+json (error middleware, registered last)
│   │   ├── idempotency.ts        # Idempotency-Key handling
│   │   ├── metrics.ts            # /metrics, request histograms
│   │   └── swagger.ts            # OpenAPI + docs UI (disabled or protected in prod)
│   │
│   ├── modules/
│   │   ├── auth/                 # register, login, refresh, logout, verify email, reset password
│   │   ├── users/
│   │   ├── organizers/
│   │   ├── venues/               # venues + seat maps
│   │   ├── categories/
│   │   ├── events/               # events + ticket types + publish/cancel
│   │   ├── bookings/             # holds, booking lifecycle
│   │   ├── payments/             # gateways, verify, webhooks, refunds
│   │   ├── tickets/              # issuance, QR, check-in
│   │   ├── promo-codes/
│   │   ├── notifications/        # outbox, email templates
│   │   ├── uploads/              # presigned URLs
│   │   ├── admin/
│   │   └── health/
│   │   # each module:
│   │   #   <name>.routes.ts      → URL + schema + auth wiring only
│   │   #   <name>.schemas.ts     → Zod request/response schemas
│   │   #   <name>.service.ts     → business rules, transactions, enqueues
│   │   #   <name>.repository.ts  → Prisma Client calls + $queryRaw only
│   │   #   <name>.jobs.ts        → BullMQ processors owned by this module
│   │   #   <name>.test.ts
│   │
│   └── generated/prisma/         # Prisma Client output (gitignored, rebuilt by `prisma generate`)
│
├── prisma/
│   ├── schema.prisma             # models mirroring database.md
│   ├── migrations/               # generated by `migrate dev --create-only`, then hand-edited
│   ├── sql/                      # TypedSQL files for hot-path raw queries (typed at generate time)
│   └── seed.ts
├── prisma.config.ts              # schema path, migrations path, seed command, DIRECT_URL
├── test/                         # integration + e2e (Testcontainers)
├── load/                         # k6 scripts (booking rush, check-in burst)
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
└── package.json
```

### Layering rules

| Layer             | May do                                                                                                                        | Must not do                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Route**         | Declare path, method, Zod `validate()` + auth middleware, call one service method, set status code                                 | Business logic, SQL, try/catch for flow control                              |
| **Service**       | Business rules, authorization on resources (ownership), open transactions, call repositories, enqueue jobs, write outbox rows | Touch `req`/`res`, build HTTP responses                                |
| **Repository**    | Queries; accepts an optional `tx` so callers compose transactions                                                             | Business decisions, calling other repositories' tables of a different module |
| **Job processor** | Call services; be **idempotent**                                                                                              | Assume it runs exactly once                                                  |

### 3.1 Data access with Prisma

Prisma handles ~90% of queries (CRUD, relations, nested writes, pagination). The few queries that **guarantee correctness under concurrency** stay as raw SQL, because Prisma can't express a conditional update like `quantity_reserved + quantity_sold + n <= quantity_total` (column arithmetic in `WHERE`) or `FOR UPDATE SKIP LOCKED`.

| Use Prisma Client for | Use `$queryRaw` / TypedSQL for |
|---|---|
| Users, organizers, venues, categories, event CRUD | Reserve stock on `ticket_types` (atomic conditional `UPDATE … RETURNING`) |
| Reading bookings/tickets with `include`/`select` | Claim seats in `event_seats` |
| Nested create (booking + items in one call) | Check-in `UPDATE … WHERE status='valid' RETURNING` |
| Optimistic locking via `updateMany({ where: { id, version } })` | Expiry sweep and outbox relay (`FOR UPDATE SKIP LOCKED`) |
| Cursor pagination (`cursor`, `take`, `skip: 1`) | Full-text search (`search_vector @@ websearch_to_tsquery(…)`), heavy reports |

#### Client setup

```ts
// src/lib/prisma.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { env } from "../config/env";
import { logger } from "./logger";

const log = logger.child({ module: "prisma" });

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,      // pooled URL (PgBouncer in prod)
  max: env.DB_POOL_MAX,                    // per-process pool size
  statement_timeout: 5_000,                // API default; workers use a longer value
  idle_in_transaction_session_timeout: 10_000,
});

const base = new PrismaClient({ adapter });

// slow-query logging through pino, with request context via the logger mixin
export const prisma = base.$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      const start = performance.now();
      try {
        return await query(args);
      } finally {
        const ms = performance.now() - start;
        if (ms > 200) log.warn({ model, operation, ms: Math.round(ms) }, "slow query");
      }
    },
  },
});
export type Db = typeof prisma;
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];
```

- **One client per process** (module singleton). Never create a `PrismaClient` per request.
- `await prisma.$disconnect()` is part of graceful shutdown (§12).
- **Read replica:** a second client on `DATABASE_REPLICA_URL` (or `@prisma/extension-read-replicas`) for stats, exports and public listings.

#### Schema excerpt

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum BookingStatus {
  pending
  confirmed
  cancelled
  expired
  refunded
  partially_refunded
  @@map("booking_status")
}

model TicketType {
  id               String    @id @default(dbgenerated("uuidv7()")) @db.Uuid
  eventId          String    @map("event_id") @db.Uuid
  name             String
  price            BigInt                                   // minor units (paisa)
  currency         String    @default("NPR") @db.Char(3)
  quantityTotal    Int       @map("quantity_total")
  quantityReserved Int       @default(0) @map("quantity_reserved")
  quantitySold     Int       @default(0) @map("quantity_sold")
  salesStartAt     DateTime? @map("sales_start_at") @db.Timestamptz
  salesEndAt       DateTime? @map("sales_end_at") @db.Timestamptz
  isActive         Boolean   @default(true) @map("is_active")
  version          Int       @default(0)

  event        Event         @relation(fields: [eventId], references: [id], onDelete: Cascade)
  bookingItems BookingItem[]

  @@unique([eventId, name])
  @@index([eventId])
  @@map("ticket_types")
}

model Event {
  id           String                    @id @default(dbgenerated("uuidv7()")) @db.Uuid
  slug         String                    @unique @db.Citext
  searchVector Unsupported("tsvector")?  @map("search_vector")
  // ...
  @@map("events")
}
```

Conventions: models are `PascalCase` with `@@map("snake_case_table")`, fields `camelCase` with `@map("snake_case")`, so the DB matches `database.md` exactly while TS stays idiomatic. All timestamps are `@db.Timestamptz`. Money is `BigInt`.

#### Things the Prisma schema can't express (added by hand in migration SQL)

Create the migration with `prisma migrate dev --create-only --name <name>`, append the SQL below, then run `prisma migrate dev`:

- `CREATE EXTENSION IF NOT EXISTS citext;` / `pg_trgm`
- **CHECK constraints:** `quantity_reserved + quantity_sold <= quantity_total`, `ends_at > starts_at`, booking total formula, etc.
- **Partial unique indexes:** `one_success_per_booking ON payments (booking_id) WHERE status = 'succeeded'`, `tickets (event_seat_id) WHERE event_seat_id IS NOT NULL`
- **Partial indexes** for the expiry job and listings (`WHERE status = 'pending'`, `WHERE deleted_at IS NULL`)
- **Generated column + GIN index** for `events.search_vector`

Never run `prisma db push` against shared/prod databases; it skips migration history. CI runs `prisma migrate diff` to fail the PR if `schema.prisma` and the migrations disagree.

#### Hot path example: create booking

```ts
// src/modules/bookings/bookings.service.ts (simplified)
export async function createBooking(userId: string, input: CreateBookingInput) {
  // lock rows in a stable order to avoid deadlocks
  const items = [...input.items].sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId));

  return prisma.$transaction(
    async (tx) => {
      const priced: { ticketTypeId: string; quantity: number; unitPrice: bigint }[] = [];

      for (const item of items) {
        const rows = await tx.$queryRaw<{ price: bigint }[]>`
          UPDATE ticket_types
          SET quantity_reserved = quantity_reserved + ${item.quantity}
          WHERE id = ${item.ticketTypeId}::uuid
            AND event_id = ${input.eventId}::uuid
            AND is_active
            AND now() BETWEEN coalesce(sales_start_at, '-infinity') AND coalesce(sales_end_at, 'infinity')
            AND quantity_reserved + quantity_sold + ${item.quantity} <= quantity_total
          RETURNING price`;
        if (rows.length === 0) throw Conflict("TICKET_SOLD_OUT", "Not enough tickets available", { ticketTypeId: item.ticketTypeId });
        priced.push({ ...item, unitPrice: rows[0].price });
      }

      const subtotal = priced.reduce((sum, p) => sum + p.unitPrice * BigInt(p.quantity), 0n);

      return tx.booking.create({
        data: {
          bookingCode: generateBookingCode(),
          userId,
          eventId: input.eventId,
          idempotencyKey: input.idempotencyKey,
          subtotal,
          totalAmount: subtotal,             // promo/fees applied here in the real version
          currency: "NPR",
          expiresAt: new Date(Date.now() + env.BOOKING_HOLD_MINUTES * 60_000),
          items: {
            create: priced.map((p) => ({
              ticketTypeId: p.ticketTypeId,
              quantity: p.quantity,
              unitPrice: p.unitPrice,
              lineTotal: p.unitPrice * BigInt(p.quantity),
            })),
          },
        },
        include: { items: true },
      });
    },
    { maxWait: 2_000, timeout: 5_000 },     // keep interactive transactions short
  );
  // after commit: enqueue booking-expiry delayed job (see §8)
}
```

#### Prisma rules for this codebase

1. **Raw SQL only through tagged templates** (`$queryRaw\`…${value}\``), which are parameterized. `$queryRawUnsafe` / `$executeRawUnsafe` are banned by an ESLint rule.
2. **Interactive transactions are short**: no HTTP calls, queue adds or email inside `$transaction`. Default `timeout: 5s`.
3. **Repositories accept `tx: Tx = prisma`** so services can compose several repository calls in one transaction.
4. **Always `select` what a list needs.** Avoid returning whole rows (e.g. `description`, `metadata`) for cards. Use `include` (or `relationLoadStrategy: "join"`) instead of looping queries (no N+1).
5. **BigInt to JSON:** Prisma returns `bigint` for money. Response Zod schemas convert to `number` (safe up to 2^53 paisa), so `JSON.stringify` never throws.
6. **Optimistic concurrency:** `updateMany({ where: { id, version }, data: { ...changes, version: { increment: 1 } } })`; `count === 0` → `412`.
7. **Migrations use `DIRECT_URL`** (bypasses PgBouncer); the app uses the pooled `DATABASE_URL`.

---

## 4. REST API conventions

### 4.1 Basics

- **Base path:** `/api/v1`. A breaking change means `/api/v2`; additive changes (new fields, new endpoints) don't.
- **Resources are plural nouns:** `/events`, `/events/{eventId}/ticket-types`. Actions that aren't CRUD use a sub-resource verb: `POST /events/{id}/publish`, `POST /bookings/{id}/cancel`.
- **JSON only**, `camelCase` fields, UTF-8. Request bodies are capped (1 MB default; uploads go to S3 directly).
- **IDs** are UUIDs. Human codes (`bookingCode`, `ticketCode`) are separate fields.
- **Money** is always an object of integer minor units: `{ "amount": 150000, "currency": "NPR" }`. Never floats.
- **Time** is ISO-8601 UTC (`2026-11-05T10:30:00Z`); events also return `timezone`.
- **Nullable vs absent:** fields are always present in responses (null when empty), which keeps clients simple.

### 4.2 HTTP methods and status codes

| Method   | Use                        | Success                                                  |
| -------- | -------------------------- | -------------------------------------------------------- |
| `GET`    | Read; safe and cacheable   | `200`                                                    |
| `POST`   | Create or action           | `201` + `Location` header (create), `200`/`202` (action) |
| `PATCH`  | Partial update             | `200`                                                    |
| `PUT`    | Full replace (rarely used) | `200`                                                    |
| `DELETE` | Soft delete / revoke       | `204`                                                    |

| Code          | When                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `400`         | Malformed JSON, failed Zod validation                                                              |
| `401`         | Missing/invalid/expired access token                                                               |
| `403`         | Authenticated but not allowed (wrong role, not owner)                                              |
| `404`         | Not found **or** exists but caller can't see it (don't leak existence of private resources)        |
| `409`         | Conflict: sold out, seat taken, duplicate unique field, invalid state transition, version mismatch |
| `412`         | `If-Match` ETag mismatch (optimistic concurrency)                                                  |
| `422`         | Semantically invalid (e.g. `endsAt` before `startsAt`, promo code expired)                         |
| `429`         | Rate limited (with `Retry-After`)                                                                  |
| `500`         | Unexpected; details only in logs                                                                   |
| `502/503/504` | Upstream gateway failure / dependency down / timeout                                               |

### 4.3 Error format: RFC 9457 Problem Details

Every error has the same shape (`Content-Type: application/problem+json`):

```json
{
  "type": "https://api.example.com/problems/sold-out",
  "title": "Ticket type sold out",
  "status": 409,
  "code": "TICKET_SOLD_OUT",
  "detail": "Only 2 'VIP' tickets remain; 4 requested.",
  "instance": "/api/v1/bookings",
  "requestId": "01JC9V5ZQ8M2...",
  "errors": [
    { "path": "items[0].quantity", "message": "Exceeds remaining stock" }
  ]
}
```

- `code` is a stable machine-readable string the frontend switches on. `title`/`detail` are for humans.
- `requestId` lets support find the exact log lines.
- 5xx responses never include stack traces, SQL or internal messages.

### 4.4 Pagination, filtering, sorting

**Cursor (keyset) pagination** for all lists. Offset pagination gets slow on large tables and skips or duplicates rows when data changes.

```
GET /api/v1/events?limit=20&cursor=eyJzIjoiMjAyNi0xMS0wNVQxMDowMFoiLCJpZCI6Ii4uLiJ9
```

```json
{
  "data": [ ... ],
  "page": { "nextCursor": "eyJ...", "hasMore": true, "limit": 20 }
}
```

- The cursor is an opaque base64url of `(sortKey, id)`; the query is `WHERE (starts_at, id) > ($1, $2) ORDER BY starts_at, id LIMIT $limit + 1`.
- `limit` defaults to 20, max 100.
- Filters are explicit query params validated by Zod: `?category=music&city=kathmandu&from=2026-11-01&to=2026-12-01&q=jazz`.
- Sorting from an allowlist only: `?sort=startsAt` / `?sort=-createdAt`. Never interpolate user input into `ORDER BY`.
- Admin-only screens that need page numbers may use offset with a hard cap.

### 4.5 Idempotency

Clients send `Idempotency-Key: <uuid>` on **non-idempotent, money-related POSTs**: create booking, initiate payment, request refund.

1. The middleware looks up `(userId, key)` in Redis (`idem:{userId}:{key}`, TTL 24h).
2. Not found → set it to `in_progress` with `SET NX`, run the handler, store `{status, body, requestHash}`.
3. Found with result → replay the stored response (same status and body).
4. Found `in_progress` → `409 REQUEST_IN_PROGRESS`.
5. Same key with a different body hash → `422 IDEMPOTENCY_KEY_REUSED`.

The DB also has `UNIQUE (user_id, idempotency_key)` on `bookings` as a last line of defence if Redis is flushed.

### 4.6 Optimistic concurrency

Editable organizer resources (events, ticket types) return `ETag: "v{version}"`. Updates must send `If-Match`; the repository runs `UPDATE … WHERE id=$1 AND version=$2`, and 0 rows → `412`. This stops two co-organizers silently overwriting each other.

### 4.7 HTTP caching

- Public read endpoints (`GET /events`, `GET /events/{slug}`) set `Cache-Control: public, max-age=30, stale-while-revalidate=60` and `ETag`, so a CDN can absorb listing traffic.
- Anything user-specific: `Cache-Control: private, no-store`.
- Live availability (`/events/{id}/availability`) uses `max-age=2–5s` at most.

---

## 5. Endpoint catalog (v1)

`🔓` public · `👤` any authenticated user · `🎪` organizer (owner of the resource) · `🎫` event staff (scanner/manager) · `🛡️` admin

### Auth

| Method | Path                    | Access      | Notes                                                        |
| ------ | ----------------------- | ----------- | ------------------------------------------------------------ |
| POST   | `/auth/register`        | 🔓          | Sends verification email (queued)                            |
| POST   | `/auth/login`           | 🔓          | Returns access token; sets refresh cookie. Strict rate limit |
| POST   | `/auth/refresh`         | 🔓 (cookie) | Rotates refresh token; reuse detection                       |
| POST   | `/auth/logout`          | 👤          | Revokes current session                                      |
| POST   | `/auth/logout-all`      | 👤          | Revokes all sessions                                         |
| POST   | `/auth/verify-email`    | 🔓          | `{ token }`                                                  |
| POST   | `/auth/forgot-password` | 🔓          | Always `202`, whether or not the email exists                |
| POST   | `/auth/reset-password`  | 🔓          | Revokes all sessions on success                              |
| GET    | `/auth/sessions`        | 👤          | List active devices                                          |

### Users & organizers

| Method      | Path                    | Access                              |
| ----------- | ----------------------- | ----------------------------------- |
| GET / PATCH | `/me`                   | 👤                                  |
| POST        | `/me/organizer-profile` | 👤 (become an organizer)            |
| GET / PATCH | `/me/organizer-profile` | 🎪                                  |
| GET         | `/organizers/{slug}`    | 🔓 public profile + upcoming events |

### Catalog

| Method          | Path                               | Access  | Notes                                                            |
| --------------- | ---------------------------------- | ------- | ---------------------------------------------------------------- |
| GET             | `/categories`                      | 🔓      | Cached                                                           |
| GET             | `/events`                          | 🔓      | Published + public only; filters, search, cursor                 |
| GET             | `/events/{idOrSlug}`               | 🔓      | Includes ticket types (not counts of reserved, only `available`) |
| GET             | `/events/{id}/availability`        | 🔓      | Lightweight, short cache                                         |
| GET             | `/events/{id}/seats`               | 🔓      | Seat map with status (reserved seating)                          |
| POST            | `/events`                          | 🎪      | Creates `draft`                                                  |
| PATCH           | `/events/{id}`                     | 🎪      | `If-Match` required                                              |
| POST            | `/events/{id}/publish`             | 🎪      | Validates completeness; generates `event_seats`                  |
| POST            | `/events/{id}/cancel`              | 🎪 / 🛡️ | Enqueues refund fan-out, `202`                                   |
| DELETE          | `/events/{id}`                     | 🎪      | Only drafts (soft delete)                                        |
| GET/POST        | `/events/{id}/ticket-types`        | 🔓 / 🎪 |                                                                  |
| PATCH/DELETE    | `/events/{id}/ticket-types/{ttId}` | 🎪      | Can't reduce `quantityTotal` below sold + reserved               |
| GET/POST/DELETE | `/events/{id}/staff`               | 🎪      | Add scanners/co-managers                                         |
| GET             | `/me/events`                       | 🎪      | Organizer dashboard list                                         |
| GET             | `/events/{id}/stats`               | 🎪      | Sales, revenue, check-ins (read replica)                         |
| GET             | `/events/{id}/attendees`           | 🎪      | Paginated; CSV export is a queued job                            |
| CRUD            | `/venues`, `/venues/{id}/seats`    | 🎪 / 🛡️ |                                                                  |

### Bookings, payments, tickets

| Method | Path                           | Access             | Notes                                                                                    |
| ------ | ------------------------------ | ------------------ | ---------------------------------------------------------------------------------------- |
| POST   | `/bookings`                    | 👤                 | **Idempotency-Key required.** Reserves stock, returns `pending` booking with `expiresAt` |
| GET    | `/me/bookings`                 | 👤                 |                                                                                          |
| GET    | `/bookings/{id}`               | 👤 owner / 🎪      |                                                                                          |
| POST   | `/bookings/{id}/cancel`        | 👤 owner           | Only `pending`; releases hold                                                            |
| POST   | `/bookings/{id}/payments`      | 👤 owner           | **Idempotency-Key required.** `{ provider }` → returns redirect URL / form params        |
| POST   | `/payments/{provider}/verify`  | 👤                 | Called by frontend after gateway redirect; **server re-verifies with the gateway**       |
| POST   | `/webhooks/{provider}`         | 🔓 (signature)     | Stores raw event, `200` fast, processes in queue                                         |
| POST   | `/bookings/{id}/refunds`       | 👤 owner / 🎪 / 🛡️ | Policy-checked, queued                                                                   |
| GET    | `/me/tickets`                  | 👤                 |                                                                                          |
| GET    | `/tickets/{id}`                | 👤 owner           | Includes QR payload                                                                      |
| GET    | `/tickets/{id}/pdf`            | 👤 owner           | Redirects to a short-lived signed S3 URL                                                 |
| PATCH  | `/tickets/{id}/holder`         | 👤 owner           | Assign to guest                                                                          |
| POST   | `/events/{id}/check-ins`       | 🎫                 | `{ ticketCode }`; atomic, scan-twice-safe                                                |
| GET    | `/events/{id}/check-ins/stats` | 🎫                 |                                                                                          |

### Misc

| Method | Path                            | Access                |
| ------ | ------------------------------- | --------------------- | ---------------------------------------------------- |
| POST   | `/promo-codes/validate`         | 👤                    |
| CRUD   | `/events/{id}/promo-codes`      | 🎪                    |
| POST   | `/uploads/presign`              | 👤                    | `{ purpose, contentType, size }` → presigned PUT URL |
| GET    | `/admin/*`                      | 🛡️                    | users, organizer verification, audit logs            |
| GET    | `/health/live`, `/health/ready` | 🔓 (internal)         |
| GET    | `/metrics`                      | internal network only |

---

## 6. Critical flows

### 6.1 Create booking (the hot path)

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant R as Redis
    participant DB as Postgres
    participant Q as Queue

    C->>A: POST /bookings (Idempotency-Key, items)
    A->>R: rate limit + idempotency SET NX
    A->>A: Zod validate, load event (cache), check on-sale window
    A->>DB: BEGIN
    A->>DB: UPDATE ticket_types SET reserved += n WHERE … AND fits (per item)
    alt any update returns 0 rows
        A->>DB: ROLLBACK
        A-->>C: 409 TICKET_SOLD_OUT
    else all reserved
        A->>DB: INSERT bookings (pending, expires_at = now()+10m), booking_items (price snapshot)
        A->>DB: COMMIT
        A->>Q: add delayed job booking.expire (delay 10m, jobId = bookingId)
        A->>R: store idempotent response
        A-->>C: 201 { booking, expiresAt }
    end
```

Rules:

- Lock order: when several ticket types are in one booking, update them **sorted by id** to avoid deadlocks.
- Transaction is short: no network calls inside it.
- The per-booking delayed expiry job gives precise expiry; the every-minute sweep (`database.md` §6.3) is the safety net if a job is lost.
- Reserved seating: the same flow but with the `event_seats` atomic claim; `rowCount < requested` → rollback → `409 SEAT_UNAVAILABLE` with the conflicting seat ids.
- **Free events:** confirm in the same transaction (payment row with `provider='free'`), issue tickets, write outbox.

### 6.2 Payment (eSewa / Khalti)

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant G as Gateway
    participant DB as Postgres
    participant Q as Queue/Worker

    C->>A: POST /bookings/{id}/payments {provider}
    A->>DB: check booking pending & not expired; INSERT payments (initiated)
    A->>G: initiate (Khalti: /epayment/initiate → pidx) / build signed eSewa form
    A-->>C: redirect URL / form fields
    C->>G: pays on gateway
    G-->>C: redirect to frontend success URL (?pidx / ?data)
    C->>A: POST /payments/{provider}/verify
    A->>G: server-side lookup (Khalti lookup / eSewa status API)
    Note over A: Trust ONLY the lookup response, never redirect params
    A->>A: check status=COMPLETE, amount == booking.total, ref matches
    A->>DB: BEGIN: payment succeeded → booking confirmed → counters → tickets → outbox
    A->>DB: COMMIT
    A-->>C: 200 { booking: confirmed, tickets }
    Q->>Q: outbox relay → email + PDF jobs
```

Rules:

- **Never trust the client or redirect.** Verify server-to-server, compare amount (minor units), currency and our own reference (`transaction_uuid` / `purchase_order_id` = payment id).
- eSewa signatures: verify HMAC-SHA256 with `crypto.timingSafeEqual`.
- Gateway calls use timeouts (5s connect / 10s total), retry only idempotent lookups, and sit behind a circuit breaker. If the gateway is down, return `503 PAYMENT_PROVIDER_UNAVAILABLE` and queue a `payment.reconcile` job so the payment isn't lost.
- **Paid but expired:** the booking update `WHERE status='pending'` returns 0 rows → try to re-reserve stock; if impossible, enqueue an automatic refund and notify the user.
- **Reconciliation job** (every 5 min): `payments` stuck in `initiated/pending` > 15 min are looked up at the gateway and settled. This catches users who closed the browser after paying.

### 6.3 Webhooks / callbacks

1. Verify signature (where the provider supports it). Invalid → `401`, log at `warn`.
2. `INSERT INTO payment_webhook_events … ON CONFLICT (provider, event_key) DO NOTHING`.
3. Enqueue `payment.webhook.process` with `jobId = webhookEventId` (dedupe), respond `200` immediately (< 100 ms).
4. The worker runs the same `confirmPayment()` service as §6.2. That function is idempotent, so a verify call and a webhook racing each other both end in exactly one confirmation (unique indexes guarantee it).

### 6.4 Check-in

`POST /events/{id}/check-ins { ticketCode }`: one atomic `UPDATE … WHERE status='valid' RETURNING` (see `database.md`). On 0 rows, a follow-up `SELECT` tells the scanner _why_: `ALREADY_CHECKED_IN` (with time and scanner), `WRONG_EVENT`, `CANCELLED`, `NOT_FOUND`. The scanner role is verified against `event_staff`. Rate limit is per scanner device, generous (burst at gates).

### 6.5 Event cancellation (fan-out)

`POST /events/{id}/cancel` → set status `cancelled` + write an `event.cancelled` outbox row in one transaction → `202 Accepted`.
The worker pages through confirmed bookings in batches of 100 and enqueues one `refund.process` job per booking (`jobId = refund:{bookingId}`) plus a notification. Progress is visible via `GET /events/{id}` (`refundProgress`).

---

## 7. Security

### 7.1 Authentication

| Item                              | Design                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token                      | JWT, **15 min**, signed **EdDSA (Ed25519)** or RS256 with `kid` header for key rotation. Claims: `sub`, `role`, `sid` (session id), `iat`, `exp`, `iss`, `aud`. Sent as `Authorization: Bearer`. The frontend keeps it **in memory**, not localStorage. |
| Refresh token                     | 256-bit random opaque string, **30 days**, in an `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie. DB stores only `sha256(token)` in `auth_sessions`.                                                                                      |
| Rotation                          | Every `/auth/refresh` revokes the old token and issues a new one. **Reuse detection:** presenting an already-rotated token revokes the whole session family (likely theft).                                                                             |
| Passwords                         | argon2id (m=19 MiB, t=2, p=1 minimum), min length 8, checked against a breached-password list (k-anonymity HIBP API, optional).                                                                                                                         |
| Login protection                  | Rate limit per IP **and** per email (5/min, 20/hour); generic "invalid email or password" message; constant-time compare; optional lockout with backoff.                                                                                                |
| Email verification / reset tokens | Random 256-bit, stored hashed, single-use, 15–60 min expiry.                                                                                                                                                                                            |
| Suspended users                   | `authenticate` middleware checks a cached `user:status:{id}` (Redis, 60 s TTL) so suspension takes effect within a minute without per-request DB hits.                                                                                                              |

### 7.2 Authorization

- **RBAC** for coarse access: `requireRole('organizer')`.
- **Ownership checks in the service layer** for every resource (fixes OWASP API1 _Broken Object Level Authorization_): e.g. `assertEventOwner(event, user)`. Never rely on "the client wouldn't send someone else's id".
- Queries scope by owner where possible: `WHERE id=$1 AND organizer_id=$2`, so a missing permission looks like `404`.
- **Field-level allowlists** on input (Zod `.strict()` objects) prevent mass assignment (e.g. a user PATCHing `role: "admin"`).
- **Response schemas** strip internal fields (`password_hash`, `provider_payload`, `online_url` for non-ticket-holders).

### 7.3 Transport and HTTP hardening

- TLS terminated at the proxy; HSTS enabled. API trusts `X-Forwarded-*` **only** from the proxy (`trustProxy` set to the proxy's IP/CIDR).
- `helmet`: strict headers (API returns JSON, so CSP `default-src 'none'`).
- `cors`: explicit origin allowlist from env, `credentials: true` only for the frontend origin. Never `*` with credentials.
- **CSRF:** the access token is a header (not CSRF-able). The refresh cookie is `SameSite=Strict` and `/auth/refresh` additionally requires a custom header (`X-Requested-With`) and an `Origin` check.
- Body limit 1 MB; request timeout 30 s; header/connection timeouts set to resist slowloris (plus proxy limits).

### 7.4 Rate limiting

`express-rate-limit` with the **Redis store** (`rate-limit-redis`) (limits shared across replicas):

| Scope                             | Limit                                                     |
| --------------------------------- | --------------------------------------------------------- |
| Global per IP                     | 300 req / min                                             |
| Auth endpoints per IP + per email | 5 / min                                                   |
| `POST /bookings` per user         | 10 / min                                                  |
| Payment initiate per user         | 10 / min                                                  |
| Search per IP                     | 60 / min                                                  |
| Webhooks                          | Not limited per IP (provider IPs), protected by signature |

Responses include `RateLimit-*` headers and `Retry-After`.

**Traffic spikes for hot events:** for very large on-sales, put a virtual waiting room (queue tokens in Redis) in front of `POST /bookings`. Not needed for v1, but the booking endpoint is isolated so it can be added without touching other code.

### 7.5 Data protection

- **SQL injection:** Prisma Client queries and tagged-template `$queryRaw` only (both parameterized); `$queryRawUnsafe` is lint-banned. Dynamic identifiers come from allowlists.
- **Secrets:** env vars injected at runtime (Docker secrets / platform secret manager). Never in the image, the repo, or logs. `.env` is gitignored; `.env.example` documents keys.
- **Encryption at rest for sensitive columns** (`organizer_profiles.payout_details`): AES-256-GCM in the app with a key from the secret manager; key id stored next to the ciphertext for rotation.
- **PII in logs:** redacted by pino config (§10.3).
- **Uploads:** presigned S3 PUT with enforced `Content-Type` allowlist (`image/jpeg|png|webp`) and size limit; a worker validates magic bytes, strips EXIF, generates resized variants. Files are served from a separate domain/CDN.
- **SSRF:** the backend never fetches user-supplied URLs. Outbound HTTP goes only to configured hosts (gateways, email provider).
- **Dependencies:** `npm audit` / Dependabot in CI, lockfile committed, `npm ci` in Docker. Scan images with Trivy.
- **Audit log:** every privileged action (publish, cancel, refund, role change, organizer verification) writes `audit_logs` in the same transaction.

### 7.6 OWASP API Security Top 10 (2023) mapping

| Risk                                                 | Mitigation here                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| API1 Broken object level authz                       | Service-layer ownership checks, owner-scoped queries                                      |
| API2 Broken authentication                           | Short JWT, rotating hashed refresh tokens, argon2id, rate limits                          |
| API3 Broken object property level authz              | Zod `.strict()` input, response schemas strip fields                                      |
| API4 Unrestricted resource consumption               | Rate limits, `limit` max 100, body limits, timeouts, query timeouts                       |
| API5 Broken function level authz                     | `requireRole` on every non-public route; admin routes on a separate router with `requireRole('admin')` at router level          |
| API6 Unrestricted access to sensitive business flows | Per-user booking limits, `max_per_order`, hold expiry, idempotency, optional waiting room |
| API7 SSRF                                            | No user-supplied URL fetching; outbound host allowlist                                    |
| API8 Security misconfiguration                       | Helmet, CORS allowlist, docs disabled in prod, non-root containers                        |
| API9 Improper inventory management                   | Versioned `/api/v1`, OpenAPI generated from code                                          |
| API10 Unsafe consumption of APIs                     | Gateway responses validated with Zod, timeouts, signature checks                          |

---

## 8. Queues and background jobs (BullMQ)

### 8.1 Why queues here

Anything slow, retryable, or not needed for the HTTP response goes to a queue: the user gets a fast response, and failures retry automatically instead of being lost.

### 8.2 Transactional outbox → queue

Enqueueing directly after `COMMIT` has a gap: if the process crashes between commit and `queue.add()`, the job is lost. So for **business-critical** side effects:

1. The service writes an `outbox` / `notifications` row **inside the same transaction** as the state change.
2. After commit it _also_ tries `queue.add()` immediately (fast path).
3. The `outbox.relay` repeatable job (every 10 s) picks rows still `queued` older than 30 s with `FOR UPDATE SKIP LOCKED` and enqueues them (slow path / safety net).
4. Jobs use `jobId = outboxRowId`, so the fast and slow paths never create duplicates.

Non-critical jobs (e.g. image resize) may be enqueued directly.

### 8.3 Queue catalog

| Queue                      | Producer                              | Job                                                                                                                             | Attempts / backoff       | Concurrency                            | Idempotency key                    |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------- | ---------------------------------- |
| `email`                    | outbox relay                          | Send transactional email (verify, reset, booking confirmed, event cancelled)                                                    | 8, exponential 5s → ~10m | 20, **rate-limited** to provider quota | `notification.id`; mark `sent_at`  |
| `tickets`                  | `confirmPayment`                      | Generate QR + PDF, upload to S3                                                                                                 | 5, exp 10s               | 5 (CPU-bound)                          | `ticket.id` (skip if PDF exists)   |
| `booking-expiry`           | `createBooking` (delayed 10m) + sweep | Expire one pending booking, release stock/seats                                                                                 | 5, exp 2s                | 10                                     | `UPDATE … WHERE status='pending'`  |
| `payments`                 | webhook route, gateway outage         | `webhook.process`, `reconcile`                                                                                                  | 10, exp 30s              | 5                                      | `webhook_event.id` / `payment.id`  |
| `refunds`                  | cancel event, refund request          | Call gateway refund API                                                                                                         | 8, exp 1m                | 3, rate-limited                        | `refund.id` + provider idempotency |
| `fanout`                   | event cancelled                       | Page through bookings, enqueue refunds + emails                                                                                 | 3                        | 1 per event                            | `event.id` + cursor                |
| `media`                    | upload confirmed                      | Validate, strip EXIF, resize to webp variants                                                                                   | 3                        | 2                                      | object key                         |
| `exports`                  | organizer                             | Attendee CSV → S3 → email signed link                                                                                           | 3                        | 2                                      | export id                          |
| `maintenance` (repeatable) | scheduler                             | expiry sweep (1m), outbox relay (10s), payment reconcile (5m), event auto-complete (15m), purge expired sessions/tokens (daily) | 3                        | 1                                      | n/a                                |

### 8.4 Defaults and failure handling

```ts
// src/lib/queue.ts
import { Queue, type JobsOptions } from "bullmq";
import { bullConnection } from "./redis";

export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 }, // keep a day for debugging
  removeOnFail: { age: 14 * 24 * 3600 }, // failed jobs kept 14 days = our DLQ
};

const queues = new Map<string, Queue>();
export function getQueue(name: QueueName) {
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, { connection: bullConnection, defaultJobOptions }),
    );
  }
  return queues.get(name)!;
}

export type QueueName =
  | "email"
  | "tickets"
  | "booking-expiry"
  | "payments"
  | "refunds"
  | "fanout"
  | "media"
  | "exports"
  | "maintenance";
```

```ts
// src/worker.ts (simplified)
import { Worker, UnrecoverableError } from "bullmq";
import { logger } from "./lib/logger";
import { runWithContext } from "./lib/context";
import { processEmail } from "./modules/notifications/notifications.jobs";

const emailWorker = new Worker(
  "email",
  (job) =>
    runWithContext(
      { jobId: job.id, queue: "email", traceId: job.data.traceId },
      () => processEmail(job),
    ),
  {
    connection: bullConnection,
    concurrency: 20,
    limiter: { max: 10, duration: 1_000 }, // provider quota: 10/s
  },
);

emailWorker.on("failed", (job, err) => {
  const log = logger.child({
    queue: "email",
    jobId: job?.id,
    attempt: job?.attemptsMade,
  });
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    log.error({ err }, "job exhausted retries, moved to failed set"); // alert on this
  } else {
    log.warn({ err }, "job failed, will retry");
  }
});
```

- **Permanent errors** (invalid email address, 4xx from provider that won't change) throw `UnrecoverableError` so BullMQ stops retrying.
- **Failed set = dead-letter queue.** An admin endpoint / Bull Board (behind admin auth, internal only) lets ops inspect and retry.
- **Every processor is idempotent:** jobs can run more than once (retry after a timeout, worker crash after side effect).
- **Payloads are small:** pass ids, not objects; the processor reloads fresh state from Postgres.
- **Trace propagation:** the producer puts `traceId`/`requestId` into `job.data`, so logs for a request and its jobs join up.
- **Redis config for BullMQ:** `maxmemory-policy noeviction` and AOF persistence (`appendonly yes`), otherwise Redis may evict jobs under memory pressure. Use a separate Redis (or DB index + policy) for cache if eviction is wanted there.
- **Graceful shutdown:** on `SIGTERM`, `await worker.close()` lets in-flight jobs finish (bounded by a timeout); BullMQ's stalled-job detection re-queues anything interrupted.

---

## 9. Performance and scalability

### 9.1 Database

- **Pool sizing:** the `@prisma/adapter-pg` pool `max` per process ≈ 10. Total = replicas × (api + worker) × 10 must stay under Postgres `max_connections` (or use PgBouncer in transaction mode and keep Postgres at ~100 connections).
- **Statement timeouts:** `statement_timeout = 5s` for API connections, longer for workers/reports; `idle_in_transaction_session_timeout = 10s` so a stuck request can't hold row locks.
- **No N+1:** list endpoints load children with Prisma `include`/`select` (one query per relation, or a single join with `relationLoadStrategy: "join"`), never in a loop. A test asserts query count for key endpoints.
- **Select only needed columns** for lists (no `description`/`metadata` in listing cards).
- **Read replica** for reports, organizer stats, exports and public listings. Writes and anything read right after a write (booking → booking detail) go to the primary.
- **Hot rows:** a single popular `ticket_types` row is the contention point during an on-sale. The atomic conditional UPDATE keeps lock time to microseconds. If one tier ever exceeds ~1–2k bookings/sec, shard its stock into N bucket rows, or front it with a Redis pre-check (`DECRBY` gate) while keeping Postgres the source of truth.
- **`EXPLAIN ANALYZE`** reviewed for every new list query; `pg_stat_statements` enabled in prod.

### 9.2 Caching (Redis)

| Data                         | Key                          | TTL | Invalidation                                          |
| ---------------------------- | ---------------------------- | --- | ----------------------------------------------------- |
| Category list                | `cat:all`                    | 1h  | On admin change                                       |
| Event detail (public)        | `event:{id}:v{version}`      | 5m  | Version in key → edits create a new key automatically |
| Event listings / search page | `events:list:{hash(params)}` | 30s | TTL only (slight staleness is fine)                   |
| Availability counts          | `event:{id}:avail`           | 3s  | TTL; the booking transaction is the real check        |
| User status (suspension)     | `user:status:{id}`           | 60s | Deleted on status change                              |

- **Cache-aside** with **stampede protection** (single-flight lock `SET NX` + short wait, or probabilistic early refresh), so 5,000 requests for a just-expired hot event hit Postgres once.
- **Never cache** anything that decides money or inventory. The cache can show "3 left" while the DB says 0; the booking request then gets `409`, which is correct.

### 9.3 API process

- Response DTOs are built explicitly (Zod output schemas / mappers) so only allowlisted fields are serialized.
- Compression at the proxy (gzip/brotli), not in Node.
- `undici` keep-alive agents for outbound HTTP.
- CPU-heavy work (PDF, image resize, CSV) is always in workers, never in `api`.
- Run one Node process per container and scale containers (simpler than cluster mode; the orchestrator handles restarts).

### 9.4 Scaling roadmap

| Stage | Traffic        | Setup                                                                                                                        |
| ----- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1     | Launch         | 1 host: proxy + 2 api + 1 worker + Postgres + Redis (Compose)                                                                |
| 2     | Growing        | Managed Postgres (with backups/PITR) + managed Redis; 2–4 api replicas; CDN for public GETs and images                       |
| 3     | Popular events | PgBouncer, read replica for reports/listings, autoscale api on CPU and workers on queue depth, waiting room for big on-sales |
| 4     | Large          | Split heavy modules (notifications, media) into separate deployables; partition `audit_logs`/`notifications` by month        |

---

## 10. Logging with pino

### 10.1 Principles

- **Structured JSON to stdout**, one line per event. The container runtime / collector ships it (Loki, ELK, Datadog). The app never writes log files or ships logs itself, which keeps the event loop free.
- **pino-pretty only in development** (as a transport); production stays raw JSON.
- **Every log line carries context:** `requestId`, `traceId`, `userId` (when known), `module`; jobs carry `queue`, `jobId`, `attempt`.
- **Log events, not noise:** one access log per request (`pino-http` does this), plus meaningful business events (`booking.created`, `payment.verified`, `checkin.rejected`).
- **Never log secrets or PII:** passwords, tokens, cookies, auth headers, full card/wallet data, gateway secrets. Emails and phones are redacted or masked.

### 10.2 Levels

| Level   | Use                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------- |
| `fatal` | Process can't continue (DB unreachable at boot, invalid config) → exit                                         |
| `error` | Unexpected failure needing attention: 5xx, job exhausted retries, payment amount mismatch                      |
| `warn`  | Handled but suspicious: invalid webhook signature, refresh token reuse, rate limit hits on auth, gateway retry |
| `info`  | Request completion, business events, startup/shutdown                                                          |
| `debug` | Detailed flow for troubleshooting (off in prod; can be enabled per-instance via env)                           |
| `trace` | Very verbose (SQL), local only                                                                                 |

### 10.3 Root logger

```ts
// src/lib/logger.ts
import pino, { type LoggerOptions } from "pino";
import { env } from "../config/env";
import { getContext } from "./context";

const options: LoggerOptions = {
  level: env.LOG_LEVEL, // 'info' in prod, 'debug' in dev
  base: {
    service: "ems-api",
    env: env.NODE_ENV,
    version: env.APP_VERSION, // git sha baked into the image
    process: env.PROCESS_TYPE, // api | worker | scheduler
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  messageKey: "msg",
  formatters: {
    level: (label) => ({ level: label }), // "level":"info" instead of 30
  },
  // attach request/job context automatically to every log line
  mixin() {
    const ctx = getContext();
    return ctx
      ? {
          requestId: ctx.requestId,
          traceId: ctx.traceId,
          userId: ctx.userId,
          jobId: ctx.jobId,
        }
      : {};
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "*.password",
      "*.newPassword",
      "*.token",
      "*.refreshToken",
      "*.accessToken",
      "*.secret",
      "*.payoutDetails",
      "*.provider_payload",
      "body.password",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err: pino.stdSerializers.err, // stack, type, message, cause
  },
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        }
      : undefined,
};

export const logger = pino(options);
```

### 10.4 Request context (AsyncLocalStorage)

Services and repositories shouldn't need `request` passed in just to log. ALS carries context through async calls.

```ts
// src/lib/context.ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface Ctx {
  requestId?: string;
  traceId?: string;
  userId?: string;
  jobId?: string;
  queue?: string;
}
const als = new AsyncLocalStorage<Ctx>();

export const runWithContext = <T>(ctx: Ctx, fn: () => T) => als.run(ctx, fn);
export const getContext = () => als.getStore();
export const setUserId = (userId: string) => {
  const s = als.getStore();
  if (s) s.userId = userId;
};
```

### 10.5 Express wiring

```ts
// src/app.ts (excerpt)
import express from "express";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import { logger } from "./lib/logger";
import { runWithContext } from "./lib/context";
import { errorHandler } from "./middleware/error-handler";

export function buildApp() {
  const app = express();
  app.set("trust proxy", env.TRUST_PROXY); // proxy IP/CIDR, not `true`
  app.disable("x-powered-by");

  // request id: accept from proxy if well-formed, else generate;
  // then put it into ALS for the whole request lifecycle
  app.use((req, res, next) => {
    const incoming = req.headers["x-request-id"];
    const id =
      typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    res.setHeader("x-request-id", id);
    runWithContext({ requestId: id, traceId: currentTraceId() }, next);
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => res.getHeader("x-request-id") as string,
      autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/metrics" },
    }),
  );

  app.use(express.json({ limit: "1mb" }));

  // ... security middleware, module routers
  app.use(errorHandler); // must be registered last
  return app;
}

// src/server.ts: 30 s request timeout + slowloris-resistant timeouts
const server = buildApp().listen(env.PORT);
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
```

`pino-http` emits one `request completed` line per request (with `responseTime`, `statusCode`). Health and metrics routes are excluded via `autoLogging.ignore` to avoid noise. Express 5 forwards rejected promises from async handlers to the error middleware automatically, so routes don't need try/catch wrappers.

### 10.6 What good log lines look like

```json
{"level":"info","time":"2026-11-05T10:31:02.114Z","service":"ems-api","process":"api","version":"a1b2c3d","requestId":"0b7c…","userId":"0192…","module":"bookings","bookingId":"0193…","eventId":"0191…","items":2,"totalAmount":300000,"msg":"booking.created"}
{"level":"warn","time":"2026-11-05T10:31:40.002Z","service":"ems-api","process":"api","requestId":"9f1e…","provider":"esewa","msg":"webhook signature invalid"}
{"level":"error","time":"2026-11-05T10:32:10.551Z","service":"ems-api","process":"worker","jobId":"refund:0193…","queue":"refunds","attempt":8,"err":{"type":"GatewayError","message":"Khalti 502","stack":"…"},"msg":"job exhausted retries, moved to failed set"}
```

Module loggers: `const log = logger.child({ module: 'bookings' })`. Always pass errors as `{ err }` so the serializer captures stack and `cause`.

### 10.7 Shipping and retention

- Dev: pretty output in the terminal.
- Prod: Docker `json-file` (with rotation `max-size: 10m, max-file: 5`) or the platform log driver → collector (Promtail/Alloy → **Grafana Loki**, or Datadog/ELK).
- Retention: 14–30 days hot. Security/audit events live in the `audit_logs` table, not only in logs.
- Alerts from logs: rate of `level=error`, any `payment amount mismatch`, `refresh token reuse`, failed-job spikes.

---

## 11. Error handling

```ts
// src/lib/errors.ts
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
export const NotFound = (what: string) =>
  new AppError(404, "NOT_FOUND", `${what} not found`);
export const Forbidden = () =>
  new AppError(403, "FORBIDDEN", "You do not have access to this resource");
export const Conflict = (code: string, msg: string, details?: unknown) =>
  new AppError(409, code, msg, details);

// Prisma error codes → API errors
import { Prisma } from "../generated/prisma/client";

export function mapDbError(err: unknown): AppError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002": // unique constraint
        return Conflict("DUPLICATE", "Resource already exists", { target: err.meta?.target });
      case "P2003": // foreign key
        return new AppError(422, "INVALID_REFERENCE", "Referenced resource does not exist");
      case "P2025": // record to update/delete not found
        return NotFound("Resource");
      case "P2034": // write conflict / deadlock in a transaction
        return new AppError(503, "RETRY", "Temporary conflict, please retry");
      case "P2024": // timed out waiting for a pooled connection
        return new AppError(503, "DB_BUSY", "Service is busy, please retry");
      case "P2028": // interactive transaction timeout
        return new AppError(504, "TX_TIMEOUT", "The request took too long");
      case "P2010": // raw query failed: underlying Postgres code is in meta
        return mapPgCode(String(err.meta?.code ?? ""), err.meta);
    }
  }
  // CHECK violations and other errors surface the Postgres SQLSTATE via the driver adapter
  const pgCode = (err as { cause?: { originalCode?: string; code?: string } })?.cause;
  return mapPgCode(pgCode?.originalCode ?? pgCode?.code ?? "", undefined);
}

// Postgres SQLSTATE → API errors (constraints are our safety net)
// Note: verify how your Prisma version exposes the SQLSTATE (meta / cause) with an integration test.
function mapPgCode(code: string, meta: unknown): AppError | null {
  const err = { code, constraint: (meta as { constraint?: string })?.constraint };
  switch (err.code) {
    case "23505":
      return Conflict("DUPLICATE", "Resource already exists", {
        constraint: err.constraint,
      });
    case "23514":
      return Conflict(
        "CONSTRAINT_VIOLATION",
        "Request violates a business rule",
        { constraint: err.constraint },
      );
    case "23503":
      return new AppError(
        422,
        "INVALID_REFERENCE",
        "Referenced resource does not exist",
      );
    case "40001": // serialization failure
    case "40P01":
      return new AppError(503, "RETRY", "Temporary conflict, please retry"); // deadlock
    case "57014":
      return new AppError(504, "QUERY_TIMEOUT", "The request took too long");
    default:
      return null;
  }
}
```

The global error handler:

1. `AppError` → its status/code, logged at `info` (4xx) or `error` (5xx).
2. Zod validation error → `400` with `errors[]` paths.
3. Prisma / Postgres error → `mapDbError`, or `500`.
4. Anything else → `500 INTERNAL_ERROR`, logged at `error` with full stack, generic message to client.

Process-level: `unhandledRejection` and `uncaughtException` log `fatal` and exit with code 1. The orchestrator restarts the container; continuing in an unknown state is worse.

---

## 12. Reliability

| Concern                 | Design                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Health checks**       | `/health/live`: process is up (no dependencies). `/health/ready`: `SELECT 1` + Redis `PING` with 1 s timeout; returns `503` during shutdown so the LB drains traffic.                                                                      |
| **Graceful shutdown**   | On `SIGTERM`: mark not-ready → wait for LB to notice (~5 s) → `app.close()` (finish in-flight requests) → close workers → close queues → `prisma.$disconnect()` → `redis.quit()` → exit. Hard timeout 25 s (under Docker's `stop_grace_period: 30s`). |
| **Timeouts everywhere** | HTTP server 30 s, outbound HTTP 10 s, DB statement 5 s, Redis command 1 s, job processor timeout per queue. Nothing waits forever.                                                                                                         |
| **Retries**             | Only for idempotent operations, exponential backoff + jitter, bounded attempts.                                                                                                                                                            |
| **Circuit breaker**     | Around payment gateways and email provider (`opossum` or a small custom one): open after N consecutive failures, fail fast with `503`, half-open probe.                                                                                    |
| **Idempotency**         | Idempotency-Key header, unique DB constraints, `jobId` dedupe, conditional `UPDATE … WHERE status=…`.                                                                                                                                      |
| **Degradation**         | Redis down → caching bypassed (go to DB), rate limiter fails open for reads but **closed** for auth/booking. Email provider down → jobs retry later; booking still succeeds.                                                               |
| **Migrations**          | Run as a one-off `migrate` container before the new version starts, never on app boot from N replicas at once. Use **expand → migrate → contract** so old and new versions both work during rolling deploys.                               |
| **Backups**             | Managed Postgres with daily snapshots + PITR (WAL). Quarterly restore drill. Redis holds only rebuildable/retryable data (outbox in Postgres is the source of truth for critical jobs).                                                    |
| **Time**                | All logic uses DB `now()` for holds/expiry to avoid clock skew between replicas.                                                                                                                                                           |

---

## 13. Observability (beyond logs)

- **Metrics** (`/metrics`, internal only):
  - HTTP: `http_request_duration_seconds{route,method,status}` histogram (route template, not raw URL, to keep cardinality bounded).
  - Business: `bookings_created_total`, `bookings_confirmed_total`, `bookings_expired_total`, `payments_verified_total{provider,result}`, `checkins_total{result}`, `tickets_sold_out_total`.
  - Queues: waiting/active/failed/delayed per queue, job duration histogram.
  - Runtime: event loop lag, heap, GC (prom-client default metrics); DB pool in-use/waiting.
- **Tracing:** OpenTelemetry auto-instrumentation for http, express, pg, ioredis; trace id is injected into logs via the ALS mixin and into job data.
- **Alerts (starting set):** p95 latency > 500 ms on booking/payment routes for 5 min; 5xx rate > 1%; event loop lag > 200 ms; any queue `failed` growth; `booking-expiry` waiting > 1000; payments stuck `pending` > 15 min; DB connections > 80%.

---

## 14. Configuration

All config comes from env vars, validated once at boot. Invalid config → log `fatal` and exit.

```ts
// src/config/env.ts
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PROCESS_TYPE: z.enum(["api", "worker", "scheduler"]).default("api"),
  APP_VERSION: z.string().default("dev"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  TRUST_PROXY: z.string().default("loopback"),
  CORS_ORIGINS: z.string().transform((s) => s.split(",")),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(), // non-pooled, used by `prisma migrate` only
  DATABASE_REPLICA_URL: z.string().url().optional(),
  DB_POOL_MAX: z.coerce.number().default(10),
  REDIS_URL: z.string().url(),

  JWT_PRIVATE_KEY: z.string().min(1), // PEM, from secret store
  JWT_PUBLIC_KEY: z.string().min(1),
  JWT_ISSUER: z.string().default("ems-api"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  BOOKING_HOLD_MINUTES: z.coerce.number().default(10),
  DATA_ENCRYPTION_KEY: z.string().length(64), // hex, 32 bytes

  ESEWA_MERCHANT_CODE: z.string(),
  ESEWA_SECRET_KEY: z.string(),
  ESEWA_BASE_URL: z.string().url(),
  KHALTI_SECRET_KEY: z.string(),
  KHALTI_BASE_URL: z.string().url(),

  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  EMAIL_PROVIDER_API_KEY: z.string(),
  FRONTEND_URL: z.string().url(),
});

export const env = schema.parse(process.env);
```

---

## 15. Testing strategy

| Level           | Tooling                                                         | Focus                                                                                              |
| --------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Unit            | Vitest                                                          | Pure logic: pricing, promo discounts, money math, state transitions, signature verification        |
| Integration     | Vitest + Testcontainers (Postgres 18, Redis 8) + `app.inject()` | Every endpoint against a real DB: auth rules, validation, constraint-backed errors                 |
| **Concurrency** | Integration test firing 200 parallel bookings at 50 tickets     | Asserts exactly 50 succeed, 150 get `409`, counters consistent. Same for seats and double check-in |
| Payment         | Mocked gateway server (recorded responses)                      | Verify, duplicate callbacks, amount mismatch, paid-after-expiry, gateway timeout                   |
| Contract        | OpenAPI diff in CI                                              | Fails the PR on unintended breaking changes                                                        |
| Load            | k6 (`load/booking-rush.js`)                                     | 1k VUs on one event: p95, error rate, no oversell, DB lock waits                                   |
| Security        | `npm audit`, Trivy image scan, ZAP baseline against staging     |                                                                                                    |

---

## 16. Docker

### 16.1 Dockerfile (multi-stage, non-root, small)

```dockerfile
# syntax=docker/dockerfile:1.7

############ base ############
FROM node:24-bookworm-slim AS base
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
# tini = proper PID 1 (signal forwarding, zombie reaping)
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

############ deps (all deps for build) ############
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev

############ build ############
FROM deps AS build
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate      # → src/generated/prisma (typed client + TypedSQL)
RUN npm run build            # tsc → dist/ (includes the generated client)
RUN npm prune --omit=dev     # keep only prod deps in node_modules

############ migrate (one-off job: has the Prisma CLI) ############
FROM deps AS migrate
COPY prisma.config.ts ./
COPY prisma ./prisma
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

############ runtime ############
FROM base AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server.js"]
```

Notes:

- `bookworm-slim` (glibc) instead of Alpine to avoid native-module issues (argon2, sharp).
- Runs as the unprivileged `node` user; filesystem can be mounted read-only in prod (`read_only: true` + `tmpfs: /tmp`).
- One `runtime` image for `api`, `worker`, `scheduler` (the command differs). Migrations run from the small `migrate` target, which keeps the Prisma CLI (a dev dependency) out of the runtime image.
- `node` is started directly (not `npm start`) so `SIGTERM` reaches the app.

### 16.2 `.dockerignore`

```
node_modules
dist
.git
.env*
!.env.example
coverage
test
load
*.md
docker-compose*.yml
```

### 16.3 `docker-compose.yml` (local development)

```yaml
name: ems

x-env: &env # merged into each service's environment (YAML merge is shallow)
  NODE_ENV: development
  DATABASE_URL: postgres://ems:ems@postgres:5432/ems
  DIRECT_URL: postgres://ems:ems@postgres:5432/ems # same in dev (no PgBouncer)
  REDIS_URL: redis://redis:6379
  S3_ENDPOINT: http://minio:9000

x-app: &app
  build:
    context: .
    target: deps # dev uses the deps stage + source mount
  env_file: .env
  volumes:
    - ./src:/app/src
    - ./prisma:/app/prisma
    - ./prisma.config.ts:/app/prisma.config.ts
  depends_on:
    migrate: { condition: service_completed_successfully }
    redis: { condition: service_healthy }

services:
  # applies migrations + generates the Prisma Client, then exits; app services wait for it
  migrate:
    build: { context: ., target: deps }
    env_file: .env
    environment: *env
    volumes:
      - ./src:/app/src
      - ./prisma:/app/prisma
      - ./prisma.config.ts:/app/prisma.config.ts
    command: sh -c "npx prisma migrate deploy && npx prisma generate"
    restart: "no"
    depends_on:
      postgres: { condition: service_healthy }

  api:
    <<: *app
    command: npx tsx watch src/server.ts
    environment: { <<: *env, PROCESS_TYPE: api }
    ports: ["3000:3000"]

  worker:
    <<: *app
    command: npx tsx watch src/worker.ts
    environment: { <<: *env, PROCESS_TYPE: worker }

  scheduler:
    <<: *app
    command: npx tsx watch src/scheduler.ts
    environment: { <<: *env, PROCESS_TYPE: scheduler }

  # Prisma Studio (DB browser) at http://localhost:5555, on demand:
  #   docker compose --profile tools up studio
  studio:
    <<: *app
    command: npx prisma studio --port 5555 --browser none
    environment: *env
    ports: ["5555:5555"]
    profiles: ["tools"]

  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: ems
      POSTGRES_PASSWORD: ems
      POSTGRES_DB: ems
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql
    command: ["postgres", "-c", "shared_preload_libraries=pg_stat_statements"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ems -d ems"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:8-alpine
    command:
      [
        "redis-server",
        "--appendonly",
        "yes",
        "--maxmemory-policy",
        "noeviction",
      ]
    ports: ["6379:6379"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio12345
    ports: ["9000:9000", "9001:9001"]
    volumes:
      - miniodata:/data

  mailpit:
    image: axllent/mailpit:latest # catches all outgoing email; UI at :8025
    ports: ["8025:8025", "1025:1025"]

volumes:
  pgdata:
  redisdata:
  miniodata:
```

### 16.4 Production compose (single host, outline)

`docker-compose.prod.yml` differences:

- Uses the built `runtime` image tagged with the git SHA (`ems-api:${APP_VERSION}`), no source mounts.
- `api` with `deploy.replicas: 2`, `worker` with `replicas: 2`, `scheduler` with 1.
- **Caddy/Nginx** in front (TLS via Let's Encrypt, gzip/brotli, `client_max_body_size 1m`, sets `X-Request-Id`).
- Managed Postgres/Redis preferred; if self-hosted, add PgBouncer and volume backups.
- `restart: unless-stopped`, `stop_grace_period: 30s`, `read_only: true`, `security_opt: [no-new-privileges:true]`, `cap_drop: [ALL]`, memory/CPU limits per service.
- Logging driver `json-file` with rotation, or the collector's driver.
- Secrets via Docker secrets or the host's secret manager, not plain `environment:` in the file.
- `migrate` service uses the `migrate` build target (`ems-migrate:${APP_VERSION}`) with `DIRECT_URL` pointing at Postgres directly, not PgBouncer.
- Deploy order: build images → `docker compose run --rm migrate` (`prisma migrate deploy`) → `docker compose up -d` (rolling replace).

**Day-to-day Prisma workflow in dev:**

```bash
# change prisma/schema.prisma, then create a migration without applying it
docker compose run --rm migrate npx prisma migrate dev --create-only --name add_promo_codes
# hand-edit prisma/migrations/<timestamp>_add_promo_codes/migration.sql (CHECKs, partial indexes)
docker compose run --rm migrate npx prisma migrate dev     # apply + regenerate client
docker compose run --rm migrate npx prisma db seed         # seed demo data
```

---

## 17. CI/CD (outline)

1. **PR:** install (`npm ci`) → `prisma generate` → `prisma migrate diff` (schema vs migrations must match) → typecheck → lint → unit tests → integration tests (Testcontainers) → OpenAPI breaking-change check → `npm audit` → build image → Trivy scan.
2. **Main:** build and push image `ems-api:<sha>` → deploy to staging → run migrations → smoke tests + k6 short load → manual approval → production.
3. Rollback = redeploy previous image tag (migrations are backward-compatible thanks to expand/contract).

---

## 18. Implementation order

1. Repo scaffold: TS, Express 5, env config, pino logger + ALS context, error handler, health routes, Dockerfile + compose.
2. DB: `prisma/schema.prisma` from `database.md` + first migration (hand-add CHECKs, partial/GIN indexes, citext); `prisma/seed.ts`.
3. Auth module (register/login/refresh/logout, email verification via outbox → email queue).
4. Organizers, venues, categories, events, ticket types (+ publish).
5. Bookings (GA first), expiry job and sweep, concurrency tests.
6. Payments: Khalti + eSewa verify, webhooks, reconciliation; tickets issuance + QR/PDF worker.
7. Check-in, event staff.
8. Refunds, event cancellation fan-out, promo codes.
9. Reserved seating (if in v1 scope).
10. Metrics, tracing, dashboards, alerts, k6 load tests; production compose and deploy.

---

## 19. Open questions

- **Payment providers at launch:** Khalti + eSewa only, or Stripe as well for international buyers? => stripe too
- **Hosting target:** single VPS with Compose, or a PaaS (Railway/Render/Fly) with managed Postgres/Redis? This decides how much of §16.4 we self-manage.
- **Email provider:** Resend, SES, or Postmark? SMS needed at launch? => Resend
- **Refund policy:** who can refund (organizer self-serve vs admin only), cutoff before event start, and are fees refundable? 
- **Waiting room:** expected peak on-sale size; needed for v1 or later?
