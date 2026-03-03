CREATE TABLE "feedback_status" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"color" text,
	"description" text,
	"sort_order" integer NOT NULL,
	"is_default" boolean NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_status" ADD CONSTRAINT "feedback_status_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "status_project_value_idx" ON "feedback_status" USING btree ("project_id","value");--> statement-breakpoint
CREATE INDEX "status_project_idx" ON "feedback_status" USING btree ("project_id");