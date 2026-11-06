# Categories module

Event categories with one level of sub-categories (e.g. **Music → Concerts**). Anyone can read them; only admins can change them.

## 1. Endpoints

| Method | Path                     | Access | Notes                                                     |
| ------ | ------------------------ | ------ | --------------------------------------------------------- |
| GET    | `/categories`            | 🔓     | Full tree, sorted by `sortOrder` then name. Cached        |
| GET    | `/categories/{slug}`     | 🔓     | One category with its `parent` or `children`              |
| POST   | `/admin/categories`      | 🛡️     | `name`, optional `slug`, `parentId`, `sortOrder`          |
| PATCH  | `/admin/categories/{id}` | 🛡️     | Any of the same fields. `parentId: null` → top level      |
| DELETE | `/admin/categories/{id}` | 🛡️     | Only if it has no sub-categories (and, later, no events)  |

Rules:

- **Two levels only.** A sub-category can't have its own sub-categories (`422 MAX_DEPTH`), and a category that has children can't be moved under another one.
- **Slug** is generated from the name when omitted (`"Food & Drink"` → `food-drink`). Lowercase letters, numbers and single hyphens, max 60.
- **Name and slug are unique** (case-insensitive): `409 NAME_TAKEN` / `409 SLUG_TAKEN`.
- **Caching:** the tree is cached in Redis (`cat:all`, 1 h) and the key is deleted on every admin change, so edits show up immediately. If Redis is down, it reads from Postgres. Responses also send `Cache-Control: public, max-age=300` with an ETag.
- Every admin change writes an `audit_logs` row (`admin.category_created/updated/deleted`).

## 2. Seed data

```bash
cd server
npm run db:seed
```

Adds 10 top-level categories and 20 sub-categories (Music, Comedy, Theatre & Arts, Sports, Conferences, Workshops, …). Safe to run again: existing slugs are skipped.

## 3. Try it in Postman

Base URL: `http://localhost:4000/api/v1`.

#### Public (no token)

```
GET http://localhost:4000/api/v1/categories
GET http://localhost:4000/api/v1/categories/music
GET http://localhost:4000/api/v1/categories/concerts
```

Response of `GET /categories`:

```json
{
  "data": [
    {
      "id": "…",
      "name": "Music",
      "slug": "music",
      "parentId": null,
      "sortOrder": 0,
      "children": [
        { "id": "…", "name": "Concerts", "slug": "concerts", "parentId": "…", "sortOrder": 0 }
      ]
    }
  ]
}
```

#### Admin (Bearer token of an admin, see `users.md` §2)

Create a top-level category: `POST http://localhost:4000/api/v1/admin/categories`

```json
{ "name": "Charity" }
```

With a custom slug and position:

```json
{ "name": "Tech Meetups", "slug": "meetups", "sortOrder": 15 }
```

Create a sub-category (copy the parent's `id` from `GET /categories`):

```json
{ "name": "Jazz", "parentId": "PASTE-MUSIC-ID-HERE" }
```

Update: `PATCH http://localhost:4000/api/v1/admin/categories/{id}`

```json
{ "name": "Charity & Fundraisers", "sortOrder": 5 }
```

Move to the top level:

```json
{ "parentId": null }
```

Delete: `DELETE http://localhost:4000/api/v1/admin/categories/{id}` → `204`. A category with sub-categories returns `409 CATEGORY_HAS_CHILDREN`.

Errors to try:

| Body                                         | Result                    |
| -------------------------------------------- | ------------------------- |
| `{ "name": "Music" }` (already exists)       | `409 NAME_TAKEN`          |
| `{ "name": "X", "slug": "Bad Slug" }`        | `400 VALIDATION_FAILED`   |
| `{ "name": "Rock", "parentId": "<concerts id>" }` | `422 MAX_DEPTH`      |
| Same request with a normal user's token      | `403 FORBIDDEN`           |

## 4. Files

```
prisma/migrations/…_categories/migration.sql   # table + CHECKs (slug format, not own parent)
src/lib/slug.ts                                # slugify(), shared with organizers/events later
src/modules/categories/categories.schemas.ts   # Zod bodies/params
src/modules/categories/categories.dto.ts       # CategoryDto, buildTree()
src/modules/categories/categories.repository.ts
src/modules/categories/categories.service.ts   # cache-aside tree, admin writes + audit
src/modules/categories/categories.routes.ts    # /categories (public), /admin/categories
scripts/seed-categories.ts                     # npm run db:seed
test/categories.test.ts                        # 9 tests
```

When the events module is added, `events.category_id` will reference this table with `ON DELETE RESTRICT`, so deleting a category that events use returns `409 CATEGORY_IN_USE`.
