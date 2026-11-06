-- CreateEnum
CREATE TYPE "org_verification" AS ENUM ('pending', 'verified', 'rejected');

-- CreateTable
CREATE TABLE "organizer_profiles" (
    "user_id" UUID NOT NULL,
    "org_name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "bio" TEXT,
    "logo_url" TEXT,
    "website" TEXT,
    "verification_status" "org_verification" NOT NULL DEFAULT 'pending',
    "review_note" TEXT,
    "reviewed_at" TIMESTAMPTZ,
    "payout_method" TEXT,
    "payout_details" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizer_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizer_profiles_slug_key" ON "organizer_profiles"("slug");

-- CreateIndex
CREATE INDEX "organizer_profiles_verification_status_created_at_idx" ON "organizer_profiles"("verification_status", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "organizer_profiles" ADD CONSTRAINT "organizer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Hand-added: constraints Prisma can't express ─────────────

ALTER TABLE "organizer_profiles"
  ADD CONSTRAINT "organizer_profiles_org_name_not_blank" CHECK (length(btrim(org_name)) > 0),
  ADD CONSTRAINT "organizer_profiles_slug_format" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  ADD CONSTRAINT "organizer_profiles_payout_method" CHECK (payout_method IS NULL OR payout_method IN ('esewa', 'khalti', 'bank')),
  -- method and details are set (and cleared) together
  ADD CONSTRAINT "organizer_profiles_payout_complete" CHECK ((payout_method IS NULL) = (payout_details IS NULL)),
  -- a rejection always says why
  ADD CONSTRAINT "organizer_profiles_rejection_note" CHECK (verification_status <> 'rejected' OR review_note IS NOT NULL);
