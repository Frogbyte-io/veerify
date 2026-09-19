CREATE TABLE "support_metric_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"inbox_id" text NOT NULL,
	"agent_user_id" text,
	"date" date NOT NULL,
	"timezone" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"sample_count" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "support_metric_daily_sample_count_check" CHECK ("support_metric_daily"."sample_count" >= 0),
	CONSTRAINT "support_metric_daily_finite_value_check" CHECK ("support_metric_daily"."value" = "support_metric_daily"."value" and "support_metric_daily"."value" < 'Infinity'::double precision and "support_metric_daily"."value" > '-Infinity'::double precision)
);
--> statement-breakpoint
ALTER TABLE "support_metric_daily" ADD CONSTRAINT "support_metric_daily_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_metric_daily" ADD CONSTRAINT "support_metric_daily_inbox_id_support_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."support_inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_metric_daily" ADD CONSTRAINT "support_metric_daily_agent_user_id_user_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_metric_daily_team_inbox_date_tz_metric_null_idx" ON "support_metric_daily" USING btree ("team_id","inbox_id","date","timezone","metric") WHERE "support_metric_daily"."agent_user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "support_metric_daily_team_inbox_agent_date_tz_metric_idx" ON "support_metric_daily" USING btree ("team_id","inbox_id","agent_user_id","date","timezone","metric") WHERE "support_metric_daily"."agent_user_id" is not null;--> statement-breakpoint
CREATE INDEX "support_metric_daily_team_date_idx" ON "support_metric_daily" USING btree ("team_id","date");