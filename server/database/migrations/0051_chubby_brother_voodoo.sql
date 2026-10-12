CREATE INDEX "ai_visibility_answer_pending_idx" ON "ai_visibility_answer" USING btree ("created_at","id") WHERE "ai_visibility_answer"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "ai_visibility_answer_run_pending_idx" ON "ai_visibility_answer" USING btree ("run_id") WHERE "ai_visibility_answer"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "competitor_change_watch_idx" ON "competitor_change" USING btree ("watch_id");--> statement-breakpoint
CREATE INDEX "competitor_change_site_unseen_idx" ON "competitor_change" USING btree ("site_id") WHERE "competitor_change"."seen_at" IS NULL;--> statement-breakpoint
CREATE INDEX "marketing_usage_reserved_idx" ON "marketing_usage" USING btree ("updated_at") WHERE "marketing_usage"."metric" LIKE 'llm:%:reserved_usd_micros';--> statement-breakpoint
CREATE INDEX "mention_published_idx" ON "mention" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "mention_site_published_idx" ON "mention" USING btree ("site_id","published_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "mention_site_new_created_idx" ON "mention" USING btree ("site_id","created_at") WHERE "mention"."status" = 'new';--> statement-breakpoint
CREATE INDEX "mention_term_idx" ON "mention" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "review_request_team_trigger_created_idx" ON "review_request" USING btree ("team_id","trigger","created_at");--> statement-breakpoint
CREATE INDEX "review_request_project_sent_idx" ON "review_request" USING btree ("project_id","sent_at");--> statement-breakpoint
CREATE INDEX "seo_issue_page_idx" ON "seo_issue" USING btree ("page_id");