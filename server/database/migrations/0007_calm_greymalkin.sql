CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"feedback_id" text NOT NULL,
	"parent_comment_id" text,
	"body" text NOT NULL,
	"author_user_id" text,
	"author_session_id" text,
	"author_name" text,
	"author_email" text,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "team_id" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "created_at" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "updated_at" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "updated_at" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "updated_at" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_team_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "team_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_comment" ADD CONSTRAINT "feedback_comment_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_comment" ADD CONSTRAINT "feedback_comment_parent_comment_id_feedback_comment_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."feedback_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_comment" ADD CONSTRAINT "feedback_comment_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_comment" ADD CONSTRAINT "feedback_comment_author_session_id_anonymous_session_id_fk" FOREIGN KEY ("author_session_id") REFERENCES "public"."anonymous_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_org_idx" ON "team" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_team_user_unique" ON "team_member" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_member_user_idx" ON "team_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "comment_feedback_idx" ON "feedback_comment" USING btree ("feedback_id");--> statement-breakpoint
CREATE INDEX "comment_author_user_idx" ON "feedback_comment" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "comment_author_session_idx" ON "feedback_comment" USING btree ("author_session_id");--> statement-breakpoint
CREATE INDEX "comment_parent_idx" ON "feedback_comment" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "comment_internal_idx" ON "feedback_comment" USING btree ("is_internal");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_team_idx" ON "project" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "project_team_created_at_idx" ON "project" USING btree ("team_id","created_at");