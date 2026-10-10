ALTER TABLE "review_request" ADD COLUMN "claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN "next_attempt_at" timestamp;