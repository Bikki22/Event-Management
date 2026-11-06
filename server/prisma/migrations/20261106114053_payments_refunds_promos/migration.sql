-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('esewa', 'khalti', 'stripe', 'free', 'mock');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('initiated', 'pending', 'succeeded', 'failed', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('requested', 'processing', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "discount_type" AS ENUM ('percent', 'fixed');

-- CreateEnum
CREATE TYPE "export_status" AS ENUM ('queued', 'processing', 'ready', 'failed');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "promo_code_id" UUID;

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "booking_id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'initiated',
    "provider_txn_id" TEXT,
    "provider_ref" TEXT,
    "provider_payload" JSONB,
    "failure_reason" TEXT,
    "initiated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "booking_id" UUID NOT NULL,
    "payment_id" UUID,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "refund_status" NOT NULL DEFAULT 'requested',
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "provider_refund_id" TEXT,
    "failure_reason" TEXT,
    "requested_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "provider" "payment_provider" NOT NULL,
    "event_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "error" TEXT,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizer_id" UUID NOT NULL,
    "event_id" UUID,
    "code" CITEXT NOT NULL,
    "discount_type" "discount_type" NOT NULL,
    "discount_value" BIGINT NOT NULL,
    "max_redemptions" INTEGER,
    "times_redeemed" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMPTZ,
    "valid_until" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exports" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "status" "export_status" NOT NULL DEFAULT 'queued',
    "object_key" TEXT,
    "row_count" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_txn_id_key" ON "payments"("provider", "provider_txn_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_booking_id_key" ON "refunds"("booking_id");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_key_key" ON "payment_webhook_events"("provider", "event_key");

-- CreateIndex
CREATE INDEX "promo_codes_event_id_idx" ON "promo_codes"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_organizer_id_code_key" ON "promo_codes"("organizer_id", "code");

-- CreateIndex
CREATE INDEX "exports_event_id_created_at_idx" ON "exports"("event_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizer_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Hand-added: constraints Prisma can't express ─────────────

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_non_negative" CHECK (amount >= 0),
  ADD CONSTRAINT "payments_currency" CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "payments_completed_at" CHECK (status <> 'succeeded' OR completed_at IS NOT NULL);

-- At most one successful payment per booking: a verify call and a webhook racing each other
-- can never both mark a payment as succeeded for the same booking.
CREATE UNIQUE INDEX "payments_one_success_per_booking" ON "payments" ("booking_id") WHERE status = 'succeeded';

-- Reconciliation job: payments still waiting on the gateway
CREATE INDEX "payments_open_idx" ON "payments" ("initiated_at") WHERE status IN ('initiated', 'pending');

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_non_negative" CHECK (amount >= 0),
  ADD CONSTRAINT "refunds_completed_at" CHECK (status <> 'succeeded' OR completed_at IS NOT NULL);

ALTER TABLE "promo_codes"
  ADD CONSTRAINT "promo_codes_code_format" CHECK (code ~* '^[A-Z0-9_-]{3,32}$'),
  ADD CONSTRAINT "promo_codes_value" CHECK (
    (discount_type = 'percent' AND discount_value BETWEEN 1 AND 100)
    OR (discount_type = 'fixed' AND discount_value > 0)),
  ADD CONSTRAINT "promo_codes_redemptions" CHECK (
    times_redeemed >= 0 AND (max_redemptions IS NULL OR (max_redemptions > 0 AND times_redeemed <= max_redemptions))),
  ADD CONSTRAINT "promo_codes_window" CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from);

ALTER TABLE "exports"
  ADD CONSTRAINT "exports_ready_has_object" CHECK (status <> 'ready' OR object_key IS NOT NULL);
