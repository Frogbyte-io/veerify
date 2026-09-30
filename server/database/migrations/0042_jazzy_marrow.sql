CREATE UNIQUE INDEX "support_inbox_team_id_idx" ON "support_inbox" USING btree ("team_id","id");--> statement-breakpoint
ALTER TABLE "support_metric_daily" ADD CONSTRAINT "support_metric_daily_team_inbox_ownership_fk" FOREIGN KEY ("team_id","inbox_id") REFERENCES "public"."support_inbox"("team_id","id") ON DELETE cascade ON UPDATE no action;
