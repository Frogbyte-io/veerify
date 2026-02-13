DROP INDEX "project_org_slug_idx";--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "team_slug_unique" ON "team" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "project_team_slug_idx" ON "project" USING btree ("team_id","slug");--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_slug_unique" UNIQUE USING INDEX "team_slug_unique";
