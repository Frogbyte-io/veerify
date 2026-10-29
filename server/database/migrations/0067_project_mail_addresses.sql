CREATE TABLE "mail_entitlement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"tier" text DEFAULT 'standard' NOT NULL,
	"updated_by" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "mail_entitlement_tier_check" CHECK ("mail_entitlement"."tier" in ('standard','owner'))
);
--> statement-breakpoint
ALTER TABLE "support_inbox_address" RENAME TO "project_mail_address";--> statement-breakpoint
ALTER TABLE "support_sending_domain" RENAME TO "project_mail_domain";--> statement-breakpoint
ALTER TABLE "project_mail_address" DROP CONSTRAINT "support_inbox_address_kind_check";--> statement-breakpoint
ALTER TABLE "project_mail_address" DROP CONSTRAINT "support_inbox_address_route_status_check";--> statement-breakpoint
ALTER TABLE "project_mail_domain" DROP CONSTRAINT "support_sending_domain_status_check";--> statement-breakpoint
ALTER TABLE "project_mail_domain" DROP CONSTRAINT "support_sending_domain_ownership_check";--> statement-breakpoint
ALTER TABLE "project_mail_domain" DROP CONSTRAINT "support_sending_domain_provider_state_check";--> statement-breakpoint
ALTER TABLE "project_mail_address" DROP CONSTRAINT "support_inbox_address_inbox_id_support_inbox_id_fk";
--> statement-breakpoint
ALTER TABLE "project_mail_address" DROP CONSTRAINT "support_inbox_address_project_id_project_id_fk";
--> statement-breakpoint
ALTER TABLE "project_mail_domain" DROP CONSTRAINT "support_sending_domain_project_id_project_id_fk";
--> statement-breakpoint
ALTER TABLE "project_mail_domain" DROP CONSTRAINT "support_sending_domain_created_by_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "support_inbox_address_address_idx";--> statement-breakpoint
DROP INDEX "support_inbox_address_inbox_idx";--> statement-breakpoint
DROP INDEX "support_inbox_address_project_idx";--> statement-breakpoint
DROP INDEX "support_sending_domain_domain_idx";--> statement-breakpoint
DROP INDEX "support_sending_domain_project_idx";--> statement-breakpoint
DROP INDEX "support_sending_domain_registrable_idx";--> statement-breakpoint
DROP INDEX "support_sending_domain_due_idx";--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "spam_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_mail_address" ADD COLUMN "domain_id" text;--> statement-breakpoint
ALTER TABLE "project_mail_address" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "project_mail_address" ADD COLUMN "behaviour" text DEFAULT 'helpdesk' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_entitlement" ADD CONSTRAINT "mail_entitlement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_entitlement_organization_idx" ON "mail_entitlement" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "project_mail_address" ADD CONSTRAINT "project_mail_address_inbox_id_support_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."support_inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_mail_address" ADD CONSTRAINT "project_mail_address_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_mail_address" ADD CONSTRAINT "project_mail_address_domain_id_project_mail_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."project_mail_domain"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_mail_address" ADD CONSTRAINT "project_mail_address_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_mail_domain" ADD CONSTRAINT "project_mail_domain_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_mail_domain" ADD CONSTRAINT "project_mail_domain_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_mail_address_address_idx" ON "project_mail_address" USING btree ("address");--> statement-breakpoint
CREATE INDEX "project_mail_address_inbox_idx" ON "project_mail_address" USING btree ("inbox_id");--> statement-breakpoint
CREATE INDEX "project_mail_address_project_idx" ON "project_mail_address" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_mail_address_domain_idx" ON "project_mail_address" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_mail_domain_domain_idx" ON "project_mail_domain" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "project_mail_domain_project_idx" ON "project_mail_domain" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_mail_domain_registrable_idx" ON "project_mail_domain" USING btree ("registrable_domain");--> statement-breakpoint
CREATE INDEX "project_mail_domain_due_idx" ON "project_mail_domain" USING btree ("status","next_check_at");--> statement-breakpoint
ALTER TABLE "support_inbox" DROP COLUMN "forward_address";--> statement-breakpoint
ALTER TABLE "project_mail_address" ADD CONSTRAINT "project_mail_address_kind_check" CHECK ("project_mail_address"."kind" in ('custom','platform'));--> statement-breakpoint
ALTER TABLE "project_mail_address" ADD CONSTRAINT "project_mail_address_route_status_check" CHECK ("project_mail_address"."provider_route_status" is null or "project_mail_address"."provider_route_status" in ('active','failed'));--> statement-breakpoint
ALTER TABLE "project_mail_address" ADD CONSTRAINT "project_mail_address_behaviour_check" CHECK ("project_mail_address"."behaviour" in ('mail','helpdesk'));--> statement-breakpoint
ALTER TABLE "project_mail_domain" ADD CONSTRAINT "project_mail_domain_status_check" CHECK ("project_mail_domain"."status" in ('provisioning','pending','verified','suspended','failed','deleting'));--> statement-breakpoint
ALTER TABLE "project_mail_domain" ADD CONSTRAINT "project_mail_domain_ownership_check" CHECK ("project_mail_domain"."provider_ownership" is null or "project_mail_domain"."provider_ownership" in ('created','adopted'));--> statement-breakpoint
ALTER TABLE "project_mail_domain" ADD CONSTRAINT "project_mail_domain_provider_state_check" CHECK ("project_mail_domain"."provider_state" is null or "project_mail_domain"."provider_state" in ('active','unverified'));