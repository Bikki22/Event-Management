-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('pending', 'confirmed', 'cancelled', 'expired', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('valid', 'checked_in', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "staff_role" AS ENUM ('manager', 'scanner');

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "booking_code" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'pending',
    "subtotal" BIGINT NOT NULL,
    "discount_amount" BIGINT NOT NULL DEFAULT 0,
    "fee_amount" BIGINT NOT NULL DEFAULT 0,
    "total_amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "confirmed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "idempotency_key" TEXT,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "booking_id" UUID NOT NULL,
    "ticket_type_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "line_total" BIGINT NOT NULL,

    CONSTRAINT "booking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_code" TEXT NOT NULL,
    "booking_item_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "ticket_type_id" UUID NOT NULL,
    "holder_name" TEXT,
    "holder_email" TEXT,
    "status" "ticket_status" NOT NULL DEFAULT 'valid',
    "checked_in_at" TIMESTAMPTZ,
    "checked_in_by" UUID,
    "pdf_key" TEXT,
    "pdf_generated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_staff" (
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "staff_role" NOT NULL,
    "added_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_staff_pkey" PRIMARY KEY ("event_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_code_key" ON "bookings"("booking_code");

-- CreateIndex
CREATE INDEX "bookings_user_id_created_at_idx" ON "bookings"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "bookings_event_id_status_idx" ON "bookings"("event_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_user_id_idempotency_key_key" ON "bookings"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "booking_items_booking_id_ticket_type_id_key" ON "booking_items"("booking_id", "ticket_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_ticket_code_key" ON "tickets"("ticket_code");

-- CreateIndex
CREATE INDEX "tickets_booking_item_id_idx" ON "tickets"("booking_item_id");

-- CreateIndex
CREATE INDEX "tickets_event_id_status_idx" ON "tickets"("event_id", "status");

-- CreateIndex
CREATE INDEX "event_staff_user_id_idx" ON "event_staff"("user_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_checked_in_by_fkey" FOREIGN KEY ("checked_in_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_staff" ADD CONSTRAINT "event_staff_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_staff" ADD CONSTRAINT "event_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Hand-added: constraints Prisma can't express ─────────────

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_amounts_non_negative" CHECK (
    subtotal >= 0 AND discount_amount >= 0 AND fee_amount >= 0 AND total_amount >= 0),
  ADD CONSTRAINT "bookings_total" CHECK (total_amount = subtotal - discount_amount + fee_amount),
  ADD CONSTRAINT "bookings_currency" CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "bookings_code_format" CHECK (booking_code ~ '^EVT-[0-9A-Z]{8}$'),
  ADD CONSTRAINT "bookings_confirmed_at" CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL),
  ADD CONSTRAINT "bookings_expires_after_created" CHECK (expires_at > created_at);

ALTER TABLE "booking_items"
  ADD CONSTRAINT "booking_items_quantity_positive" CHECK (quantity > 0),
  ADD CONSTRAINT "booking_items_price_non_negative" CHECK (unit_price >= 0),
  ADD CONSTRAINT "booking_items_line_total" CHECK (line_total = unit_price * quantity);

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_code_format" CHECK (ticket_code ~ '^TKT-[0-9A-Z]{16}$'),
  ADD CONSTRAINT "tickets_checked_in" CHECK (
    (status = 'checked_in') = (checked_in_at IS NOT NULL) OR status IN ('cancelled', 'refunded'));

-- Expiry sweep: only pending bookings, by deadline
CREATE INDEX "bookings_pending_expiry_idx" ON "bookings" ("expires_at") WHERE status = 'pending';

-- PDF safety-net job: valid tickets whose PDF hasn't been generated yet
CREATE INDEX "tickets_pdf_missing_idx" ON "tickets" ("created_at") WHERE pdf_key IS NULL AND status = 'valid';
