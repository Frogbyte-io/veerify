CREATE TABLE "support_team_settings" (
	"team_id" text PRIMARY KEY NOT NULL,
	"auto_link_feedback" boolean NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_team_settings" ADD CONSTRAINT "support_team_settings_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;