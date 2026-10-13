ALTER TABLE "marketing_email_suppression" ADD COLUMN "email_hash" text;--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN "email_hash" text;--> statement-breakpoint
ALTER TABLE "testimonial" ADD COLUMN "author_email_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_email_suppression_hash_idx" ON "marketing_email_suppression" USING btree ("team_id","email_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "review_request_event_hash_idx" ON "review_request" USING btree ("project_id","trigger","source_id","email_hash");--> statement-breakpoint
CREATE INDEX "review_request_project_email_hash_idx" ON "review_request" USING btree ("project_id","email_hash");