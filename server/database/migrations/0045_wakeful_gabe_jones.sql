ALTER TABLE "mention_source_cursor" ADD COLUMN "last_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "mention_source_cursor" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visibility_run_active_site_idx" ON "ai_visibility_run" USING btree ("site_id") WHERE "ai_visibility_run"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "seo_audit_active_site_idx" ON "seo_audit" USING btree ("site_id") WHERE "seo_audit"."status" IN ('queued', 'crawling', 'analyzing');