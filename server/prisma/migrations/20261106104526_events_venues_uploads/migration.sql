-- CreateEnum
CREATE TYPE "upload_purpose" AS ENUM ('event_cover', 'organizer_logo');

-- CreateEnum
CREATE TYPE "upload_status" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "event_mode" AS ENUM ('in_person', 'online', 'hybrid');

-- CreateEnum
CREATE TYPE "seating_type" AS ENUM ('general_admission', 'reserved');

-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('draft', 'published', 'cancelled', 'completed');

-- CreateEnum
CREATE TYPE "event_visibility" AS ENUM ('public', 'unlisted', 'private');

-- CreateTable
CREATE TABLE "venues" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID,
    "name" TEXT NOT NULL,
    "address_line" TEXT,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Nepal',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "capacity" INTEGER,
    "has_seat_map" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "purpose" "upload_purpose" NOT NULL,
    "status" "upload_status" NOT NULL DEFAULT 'pending',
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL,
    "variants" JSONB,
    "width" INTEGER,
    "height" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizer_id" UUID NOT NULL,
    "venue_id" UUID,
    "category_id" UUID,
    "title" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "cover_upload_id" UUID,
    "mode" "event_mode" NOT NULL,
    "online_url" TEXT,
    "seating_type" "seating_type" NOT NULL DEFAULT 'general_admission',
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kathmandu',
    "status" "event_status" NOT NULL DEFAULT 'draft',
    "visibility" "event_visibility" NOT NULL DEFAULT 'public',
    "published_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancellation_reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "search_vector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(description, '')), 'C')
    ) STORED,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_types" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NPR',
    "quantity_total" INTEGER NOT NULL,
    "quantity_reserved" INTEGER NOT NULL DEFAULT 0,
    "quantity_sold" INTEGER NOT NULL DEFAULT 0,
    "min_per_order" INTEGER NOT NULL DEFAULT 1,
    "max_per_order" INTEGER NOT NULL DEFAULT 10,
    "sales_start_at" TIMESTAMPTZ,
    "sales_end_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "venues_owner_id_idx" ON "venues"("owner_id");

-- CreateIndex
CREATE INDEX "uploads_user_id_created_at_idx" ON "uploads"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_organizer_id_created_at_idx" ON "events"("organizer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "events_category_id_starts_at_idx" ON "events"("category_id", "starts_at");

-- CreateIndex
CREATE INDEX "events_venue_id_idx" ON "events"("venue_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_types_event_id_name_key" ON "ticket_types"("event_id", "name");

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "organizer_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizer_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_cover_upload_id_fkey" FOREIGN KEY ("cover_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Hand-added: constraints Prisma can't express ─────────────

ALTER TABLE "venues"
  ADD CONSTRAINT "venues_name_not_blank" CHECK (length(btrim(name)) > 0),
  ADD CONSTRAINT "venues_capacity_positive" CHECK (capacity IS NULL OR capacity > 0),
  ADD CONSTRAINT "venues_coordinates" CHECK (
    (latitude IS NULL) = (longitude IS NULL)
    AND (latitude IS NULL OR latitude BETWEEN -90 AND 90)
    AND (longitude IS NULL OR longitude BETWEEN -180 AND 180));

ALTER TABLE "uploads"
  ADD CONSTRAINT "uploads_size_positive" CHECK (size_bytes > 0),
  ADD CONSTRAINT "uploads_content_type" CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "uploads_ready_has_variants" CHECK (status <> 'ready' OR variants IS NOT NULL);

ALTER TABLE "events"
  ADD CONSTRAINT "events_title_not_blank" CHECK (length(btrim(title)) > 0),
  ADD CONSTRAINT "events_slug_format" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
  ADD CONSTRAINT "events_ends_after_starts" CHECK (ends_at > starts_at),
  -- in-person and hybrid events need a venue
  ADD CONSTRAINT "events_venue_required" CHECK (mode = 'online' OR venue_id IS NOT NULL),
  ADD CONSTRAINT "events_published_at" CHECK (status = 'draft' OR published_at IS NOT NULL),
  ADD CONSTRAINT "events_cancelled_at" CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  ADD CONSTRAINT "events_version_non_negative" CHECK (version >= 0);

ALTER TABLE "ticket_types"
  ADD CONSTRAINT "ticket_types_name_not_blank" CHECK (length(btrim(name)) > 0),
  ADD CONSTRAINT "ticket_types_price_non_negative" CHECK (price >= 0),
  ADD CONSTRAINT "ticket_types_currency" CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "ticket_types_quantity_total_positive" CHECK (quantity_total > 0),
  -- the inventory invariant: never oversell
  ADD CONSTRAINT "ticket_types_stock" CHECK (
    quantity_reserved >= 0 AND quantity_sold >= 0
    AND quantity_reserved + quantity_sold <= quantity_total),
  ADD CONSTRAINT "ticket_types_per_order" CHECK (min_per_order >= 1 AND max_per_order >= min_per_order),
  ADD CONSTRAINT "ticket_types_sales_window" CHECK (
    sales_start_at IS NULL OR sales_end_at IS NULL OR sales_end_at > sales_start_at);

-- Full-text search over title/summary/description
CREATE INDEX "events_search_idx" ON "events" USING GIN ("search_vector");

-- Public listing: only live, public events, ordered by start time
CREATE INDEX "events_public_listing_idx" ON "events" ("starts_at", "id")
  WHERE status = 'published' AND visibility = 'public' AND deleted_at IS NULL;

-- Venue pickers skip soft-deleted venues
CREATE INDEX "venues_city_active_idx" ON "venues" (lower(city)) WHERE deleted_at IS NULL;

-- Cleanup job: abandoned uploads
CREATE INDEX "uploads_pending_idx" ON "uploads" ("created_at") WHERE status = 'pending';
