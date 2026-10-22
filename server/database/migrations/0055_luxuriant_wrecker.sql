CREATE TABLE "support_sending_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"domain" text NOT NULL,
	"registrable_domain" text NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"provider" text NOT NULL,
	"provider_account_key" text DEFAULT '' NOT NULL,
	"provider_ownership" text,
	"provider_state" text,
	"receives_via_provider" boolean DEFAULT false NOT NULL,
	"ownership_token" text NOT NULL,
	"ownership_verified_at" timestamp,
	"ownership_failures" integer DEFAULT 0 NOT NULL,
	"provider_failures" integer DEFAULT 0 NOT NULL,
	"dns_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_at" timestamp,
	"last_checked_at" timestamp,
	"next_check_at" timestamp,
	"lease_expires_at" timestamp,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error" text,
	"expires_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "support_sending_domain_status_check" CHECK ("support_sending_domain"."status" in ('provisioning','pending','verified','suspended','failed','deleting')),
	CONSTRAINT "support_sending_domain_ownership_check" CHECK ("support_sending_domain"."provider_ownership" is null or "support_sending_domain"."provider_ownership" in ('created','adopted')),
	CONSTRAINT "support_sending_domain_provider_state_check" CHECK ("support_sending_domain"."provider_state" is null or "support_sending_domain"."provider_state" in ('active','unverified'))
);
--> statement-breakpoint
ALTER TABLE "support_inbox_address" ADD COLUMN "kind" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_inbox_address" ADD COLUMN "provider_route_id" text;--> statement-breakpoint
ALTER TABLE "support_inbox_address" ADD COLUMN "provider_route_status" text;--> statement-breakpoint
ALTER TABLE "support_sending_domain" ADD CONSTRAINT "support_sending_domain_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_sending_domain" ADD CONSTRAINT "support_sending_domain_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_sending_domain_domain_idx" ON "support_sending_domain" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "support_sending_domain_team_idx" ON "support_sending_domain" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "support_sending_domain_registrable_idx" ON "support_sending_domain" USING btree ("registrable_domain");--> statement-breakpoint
CREATE INDEX "support_sending_domain_due_idx" ON "support_sending_domain" USING btree ("status","next_check_at");--> statement-breakpoint
ALTER TABLE "support_inbox_address" ADD CONSTRAINT "support_inbox_address_kind_check" CHECK ("support_inbox_address"."kind" in ('custom','platform'));--> statement-breakpoint
ALTER TABLE "support_inbox_address" ADD CONSTRAINT "support_inbox_address_route_status_check" CHECK ("support_inbox_address"."provider_route_status" is null or "support_inbox_address"."provider_route_status" in ('active','failed'));