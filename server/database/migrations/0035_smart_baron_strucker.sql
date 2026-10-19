CREATE TABLE "csat_response" (
	"id" text PRIMARY KEY NOT NULL,
	"survey_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"agent_user_id" text,
	"rating" integer,
	"comment" text,
	"token" text NOT NULL,
	"sent_at" timestamp NOT NULL,
	"responded_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "csat_response_rating_check" CHECK ("csat_response"."rating" is null or ("csat_response"."rating" >= 0 and "csat_response"."rating" <= 10))
);
--> statement-breakpoint
CREATE TABLE "csat_survey" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"inbox_id" text,
	"name" text NOT NULL,
	"scale" text NOT NULL,
	"question" text NOT NULL,
	"follow_up_question" text,
	"send_trigger" text NOT NULL,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"contact_cooldown_minutes" integer DEFAULT 43200 NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "csat_survey_scale_check" CHECK ("csat_survey"."scale" in ('csat_5','thumbs','nps_10')),
	CONSTRAINT "csat_survey_trigger_check" CHECK ("csat_survey"."send_trigger" in ('on_resolve','on_close')),
	CONSTRAINT "csat_survey_delay_check" CHECK ("csat_survey"."delay_minutes" >= 0),
	CONSTRAINT "csat_survey_cooldown_check" CHECK ("csat_survey"."contact_cooldown_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "csat_response" ADD CONSTRAINT "csat_response_survey_id_csat_survey_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."csat_survey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csat_response" ADD CONSTRAINT "csat_response_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csat_response" ADD CONSTRAINT "csat_response_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csat_response" ADD CONSTRAINT "csat_response_agent_user_id_user_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csat_survey" ADD CONSTRAINT "csat_survey_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csat_survey" ADD CONSTRAINT "csat_survey_inbox_id_support_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."support_inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "csat_response_conversation_idx" ON "csat_response" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "csat_response_token_idx" ON "csat_response" USING btree ("token");--> statement-breakpoint
CREATE INDEX "csat_response_survey_created_at_idx" ON "csat_response" USING btree ("survey_id","created_at");--> statement-breakpoint
CREATE INDEX "csat_response_contact_sent_at_idx" ON "csat_response" USING btree ("contact_id","sent_at");--> statement-breakpoint
CREATE INDEX "csat_survey_team_idx" ON "csat_survey" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "csat_survey_inbox_idx" ON "csat_survey" USING btree ("inbox_id");--> statement-breakpoint
CREATE INDEX "csat_survey_enabled_idx" ON "csat_survey" USING btree ("team_id","is_enabled");