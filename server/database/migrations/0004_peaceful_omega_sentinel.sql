ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "custom_domain" text;--> statement-breakpoint
CREATE UNIQUE INDEX "project_custom_domain_idx" ON "project" USING btree ("custom_domain");