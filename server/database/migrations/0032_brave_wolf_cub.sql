CREATE TABLE "canned_response" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"shortcode" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canned_response" ADD CONSTRAINT "canned_response_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_response" ADD CONSTRAINT "canned_response_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "canned_response_team_shortcode_idx" ON "canned_response" USING btree ("team_id","shortcode");