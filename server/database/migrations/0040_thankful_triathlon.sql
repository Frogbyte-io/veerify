CREATE TABLE "domain" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"hostname" text NOT NULL,
	"kind" text DEFAULT 'custom_subdomain' NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"provider_domain_id" text,
	"verification_payload" jsonb,
	"dns_records" jsonb,
	"last_checked_at" timestamp,
	"activated_at" timestamp,
	"error_message" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain" ADD CONSTRAINT "domain_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_hostname_idx" ON "domain" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "domain_project_idx" ON "domain" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "domain_project_primary_idx" ON "domain" USING btree ("project_id","is_primary");--> statement-breakpoint
CREATE INDEX "domain_status_idx" ON "domain" USING btree ("status");