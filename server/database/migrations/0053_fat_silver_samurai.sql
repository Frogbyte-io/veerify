DROP INDEX "ai_visibility_answer_pending_idx";--> statement-breakpoint
ALTER TABLE "mention_source_cursor" ADD COLUMN "query_offset" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mention_source_cursor" ADD COLUMN "cycle_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "testimonial" ADD COLUMN "withdrawn_at" timestamp;--> statement-breakpoint
CREATE INDEX "ai_visibility_answer_pending_idx" ON "ai_visibility_answer" USING btree ("provider","created_at","id") WHERE "ai_visibility_answer"."status" = 'pending';