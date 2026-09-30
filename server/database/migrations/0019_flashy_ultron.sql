CREATE TABLE "contact" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"avatar_url" text,
	"company_id" text,
	"user_id" text,
	"attributes" jsonb,
	"blocked_at" timestamp,
	"merged_into_contact_id" text,
	"last_seen_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_link" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"source" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_company" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"attributes" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_support_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."support_company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_merged_into_contact_id_contact_id_fk" FOREIGN KEY ("merged_into_contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identity" ADD CONSTRAINT "contact_identity_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identity" ADD CONSTRAINT "contact_identity_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link" ADD CONSTRAINT "contact_link_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link" ADD CONSTRAINT "contact_link_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_company" ADD CONSTRAINT "support_company_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_team_email_idx" ON "contact" USING btree ("team_id","email");--> statement-breakpoint
CREATE INDEX "contact_team_created_at_idx" ON "contact" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_company_idx" ON "contact" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contact_user_idx" ON "contact" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identity_team_kind_value_idx" ON "contact_identity" USING btree ("team_id","kind","value");--> statement-breakpoint
CREATE INDEX "contact_identity_contact_idx" ON "contact_identity" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_link_contact_entity_idx" ON "contact_link" USING btree ("contact_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "contact_link_entity_idx" ON "contact_link" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_company_team_domain_idx" ON "support_company" USING btree ("team_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "support_company_team_name_idx" ON "support_company" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX "feedback_author_email_idx" ON "feedback" USING btree ("author_email");