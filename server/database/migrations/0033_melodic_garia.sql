CREATE TABLE "business_hours" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"weekly_schedule" jsonb NOT NULL,
	"holidays" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_breach" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"metric" text NOT NULL,
	"breached_at" timestamp NOT NULL,
	"notified_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"business_hours_id" text,
	"conditions" jsonb NOT NULL,
	"escalation" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_target" (
	"id" text PRIMARY KEY NOT NULL,
	"sla_policy_id" text NOT NULL,
	"metric" text NOT NULL,
	"priority" text,
	"target_minutes" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "sla_policy_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "first_response_due_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "next_response_due_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "resolution_due_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "sla_paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "sla_paused_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_breach" ADD CONSTRAINT "sla_breach_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policy" ADD CONSTRAINT "sla_policy_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policy" ADD CONSTRAINT "sla_policy_business_hours_id_business_hours_id_fk" FOREIGN KEY ("business_hours_id") REFERENCES "public"."business_hours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_target" ADD CONSTRAINT "sla_target_sla_policy_id_sla_policy_id_fk" FOREIGN KEY ("sla_policy_id") REFERENCES "public"."sla_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_hours_team_idx" ON "business_hours" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "business_hours_default_idx" ON "business_hours" USING btree ("team_id","is_default");--> statement-breakpoint
CREATE UNIQUE INDEX "sla_breach_conversation_metric_idx" ON "sla_breach" USING btree ("conversation_id","metric");--> statement-breakpoint
CREATE INDEX "sla_breach_conversation_idx" ON "sla_breach" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "sla_policy_team_idx" ON "sla_policy" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "sla_policy_team_order_idx" ON "sla_policy" USING btree ("team_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "sla_target_policy_metric_priority_idx" ON "sla_target" USING btree ("sla_policy_id","metric","priority");--> statement-breakpoint
CREATE INDEX "sla_target_policy_idx" ON "sla_target" USING btree ("sla_policy_id");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_sla_policy_id_sla_policy_id_fk" FOREIGN KEY ("sla_policy_id") REFERENCES "public"."sla_policy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_sla_policy_idx" ON "conversation" USING btree ("sla_policy_id");