DROP INDEX "notification_user_created_at_idx";--> statement-breakpoint
CREATE INDEX "notification_user_created_at_idx" ON "notification" USING btree ("user_id","created_at","id");