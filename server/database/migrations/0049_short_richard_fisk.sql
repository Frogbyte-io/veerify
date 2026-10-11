ALTER TABLE "marketing_site" ADD COLUMN "verification_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "marketing_site" ADD COLUMN "verification_failures" integer DEFAULT 0 NOT NULL;