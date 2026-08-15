CREATE TABLE "team_module_settings" (
	"team_id" text PRIMARY KEY NOT NULL,
	"feedback_enabled" boolean DEFAULT true NOT NULL,
	"roadmap_enabled" boolean DEFAULT false NOT NULL,
	"changelog_enabled" boolean DEFAULT false NOT NULL,
	"support_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_module_settings" ADD CONSTRAINT "team_module_settings_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;