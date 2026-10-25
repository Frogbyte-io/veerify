CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_member" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_project_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"auto_link_feedback" boolean DEFAULT false NOT NULL,
	"reporting_timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "changelog_entry_product" (
	"entry_id" text NOT NULL,
	"product_id" text NOT NULL,
	CONSTRAINT "changelog_entry_product_entry_id_product_id_pk" PRIMARY KEY("entry_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "organization_api_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_hint" text NOT NULL,
	"monthly_budget_cents" integer,
	"status" text DEFAULT 'unchecked' NOT NULL,
	"last_validated_at" timestamp,
	"last_error" text,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_project_id" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "access_mode" text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "business_hours" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "canned_response" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "contact_identity" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "conversation_status_event" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "csat_survey" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "sla_policy" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "support_company" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "support_counter" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "support_metric_daily" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "support_sending_domain" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "support_tag" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "marketing_data_consent" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "marketing_email_suppression" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "marketing_usage" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_project_settings" ADD CONSTRAINT "support_project_settings_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_entry_product" ADD CONSTRAINT "changelog_entry_product_entry_id_changelog_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."changelog_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_entry_product" ADD CONSTRAINT "changelog_entry_product_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_api_credential" ADD CONSTRAINT "organization_api_credential_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_api_credential" ADD CONSTRAINT "organization_api_credential_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_project_slug_idx" ON "product" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "product_project_order_idx" ON "product" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "project_member_project_user_idx" ON "project_member" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_member_user_idx" ON "project_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "changelog_entry_product_product_idx" ON "changelog_entry_product" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_api_credential_org_provider_idx" ON "organization_api_credential" USING btree ("organization_id","provider");--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_response" ADD CONSTRAINT "canned_response_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identity" ADD CONSTRAINT "contact_identity_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_status_event" ADD CONSTRAINT "conversation_status_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csat_survey" ADD CONSTRAINT "csat_survey_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policy" ADD CONSTRAINT "sla_policy_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_company" ADD CONSTRAINT "support_company_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_counter" ADD CONSTRAINT "support_counter_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_metric_daily" ADD CONSTRAINT "support_metric_daily_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_sending_domain" ADD CONSTRAINT "support_sending_domain_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tag" ADD CONSTRAINT "support_tag_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_data_consent" ADD CONSTRAINT "marketing_data_consent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_email_suppression" ADD CONSTRAINT "marketing_email_suppression_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_usage" ADD CONSTRAINT "marketing_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;