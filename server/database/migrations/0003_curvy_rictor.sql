CREATE TABLE "anonymous_session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "anonymous_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"category_id" text,
	"title" text NOT NULL,
	"body" text,
	"status" text NOT NULL,
	"author_user_id" text,
	"author_session_id" text,
	"author_name" text,
	"author_email" text,
	"vote_count" integer NOT NULL,
	"comment_count" integer NOT NULL,
	"is_pinned" boolean NOT NULL,
	"is_locked" boolean NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_category" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"icon" text,
	"color" text,
	"description" text,
	"sort_order" integer NOT NULL,
	"is_default" boolean NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"installation_id" text,
	"access_token" text,
	"webhook_secret" text,
	"sync_enabled" boolean NOT NULL,
	"auto_create_issues" boolean NOT NULL,
	"auto_sync_status" boolean NOT NULL,
	"last_sync_at" timestamp,
	"settings" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "github_integration_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "github_issue_link" (
	"id" text PRIMARY KEY NOT NULL,
	"feedback_id" text NOT NULL,
	"github_integration_id" text NOT NULL,
	"issue_number" integer NOT NULL,
	"issue_url" text NOT NULL,
	"issue_state" text,
	"last_sync_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_public" boolean NOT NULL,
	"settings" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap_item" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"priority" text,
	"quarter" text,
	"start_date" timestamp,
	"target_date" timestamp,
	"completed_date" timestamp,
	"sort_order" integer NOT NULL,
	"linked_feedback_ids" jsonb,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vote" (
	"id" text PRIMARY KEY NOT NULL,
	"feedback_id" text NOT NULL,
	"voter_user_id" text,
	"voter_session_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "github_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "github_login" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_category_id_feedback_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."feedback_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_author_session_id_anonymous_session_id_fk" FOREIGN KEY ("author_session_id") REFERENCES "public"."anonymous_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_category" ADD CONSTRAINT "feedback_category_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_integration" ADD CONSTRAINT "github_integration_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issue_link" ADD CONSTRAINT "github_issue_link_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issue_link" ADD CONSTRAINT "github_issue_link_github_integration_id_github_integration_id_fk" FOREIGN KEY ("github_integration_id") REFERENCES "public"."github_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_item" ADD CONSTRAINT "roadmap_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_voter_user_id_user_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_voter_session_id_anonymous_session_id_fk" FOREIGN KEY ("voter_session_id") REFERENCES "public"."anonymous_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anon_session_token_idx" ON "anonymous_session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "anon_session_expires_idx" ON "anonymous_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "feedback_project_idx" ON "feedback" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "feedback_category_idx" ON "feedback" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status");--> statement-breakpoint
CREATE INDEX "feedback_author_user_idx" ON "feedback" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "feedback_author_session_idx" ON "feedback" USING btree ("author_session_id");--> statement-breakpoint
CREATE INDEX "feedback_vote_count_idx" ON "feedback" USING btree ("vote_count");--> statement-breakpoint
CREATE INDEX "feedback_pinned_idx" ON "feedback" USING btree ("is_pinned");--> statement-breakpoint
CREATE INDEX "feedback_project_status_idx" ON "feedback" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "category_project_slug_idx" ON "feedback_category" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "category_project_idx" ON "feedback_category" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "category_default_idx" ON "feedback_category" USING btree ("is_default");--> statement-breakpoint
CREATE INDEX "github_integration_project_idx" ON "github_integration" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "github_integration_repo_idx" ON "github_integration" USING btree ("owner","repo");--> statement-breakpoint
CREATE UNIQUE INDEX "github_link_feedback_idx" ON "github_issue_link" USING btree ("feedback_id");--> statement-breakpoint
CREATE INDEX "github_link_integration_idx" ON "github_issue_link" USING btree ("github_integration_id");--> statement-breakpoint
CREATE INDEX "github_link_issue_idx" ON "github_issue_link" USING btree ("github_integration_id","issue_number");--> statement-breakpoint
CREATE UNIQUE INDEX "project_org_slug_idx" ON "project" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "project_org_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_public_idx" ON "project" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "roadmap_project_idx" ON "roadmap_item" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "roadmap_status_idx" ON "roadmap_item" USING btree ("status");--> statement-breakpoint
CREATE INDEX "roadmap_priority_idx" ON "roadmap_item" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "roadmap_project_status_idx" ON "roadmap_item" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "vote_user_feedback_idx" ON "vote" USING btree ("feedback_id","voter_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vote_session_feedback_idx" ON "vote" USING btree ("feedback_id","voter_session_id");--> statement-breakpoint
CREATE INDEX "vote_feedback_idx" ON "vote" USING btree ("feedback_id");--> statement-breakpoint
CREATE INDEX "vote_user_idx" ON "vote" USING btree ("voter_user_id");--> statement-breakpoint
CREATE INDEX "vote_session_idx" ON "vote" USING btree ("voter_session_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_github_id_unique" UNIQUE("github_id");