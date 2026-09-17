CREATE TABLE "automation_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"inbox_id" text,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "automation_rule_trigger_check" CHECK ("automation_rule"."trigger" in ('conversation_created','conversation_updated','message_created','time_based'))
);
--> statement-breakpoint
CREATE TABLE "automation_rule_run" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"status" text NOT NULL,
	"matched_conditions" jsonb NOT NULL,
	"applied_actions" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "automation_rule_run_status_check" CHECK ("automation_rule_run"."status" in ('applied','skipped','failed'))
);
--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_inbox_id_support_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."support_inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule_run" ADD CONSTRAINT "automation_rule_run_rule_id_automation_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule_run" ADD CONSTRAINT "automation_rule_run_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rule_team_idx" ON "automation_rule" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "automation_rule_inbox_idx" ON "automation_rule" USING btree ("inbox_id");--> statement-breakpoint
CREATE INDEX "automation_rule_enabled_order_idx" ON "automation_rule" USING btree ("team_id","is_enabled","sort_order");--> statement-breakpoint
CREATE INDEX "automation_rule_run_rule_created_at_idx" ON "automation_rule_run" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_rule_run_conversation_created_at_idx" ON "automation_rule_run" USING btree ("conversation_id","created_at");