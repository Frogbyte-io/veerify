CREATE TABLE IF NOT EXISTS "feedback_comment" (
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
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'feedback_comment_feedback_id_feedback_id_fk'
	) THEN
		ALTER TABLE "feedback_comment"
		ADD CONSTRAINT "feedback_comment_feedback_id_feedback_id_fk"
		FOREIGN KEY ("feedback_id")
		REFERENCES "public"."feedback"("id")
		ON DELETE cascade
		ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'feedback_comment_parent_comment_id_feedback_comment_id_fk'
	) THEN
		ALTER TABLE "feedback_comment"
		ADD CONSTRAINT "feedback_comment_parent_comment_id_feedback_comment_id_fk"
		FOREIGN KEY ("parent_comment_id")
		REFERENCES "public"."feedback_comment"("id")
		ON DELETE cascade
		ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'feedback_comment_author_user_id_user_id_fk'
	) THEN
		ALTER TABLE "feedback_comment"
		ADD CONSTRAINT "feedback_comment_author_user_id_user_id_fk"
		FOREIGN KEY ("author_user_id")
		REFERENCES "public"."user"("id")
		ON DELETE set null
		ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'feedback_comment_author_session_id_anonymous_session_id_fk'
	) THEN
		ALTER TABLE "feedback_comment"
		ADD CONSTRAINT "feedback_comment_author_session_id_anonymous_session_id_fk"
		FOREIGN KEY ("author_session_id")
		REFERENCES "public"."anonymous_session"("id")
		ON DELETE set null
		ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_feedback_idx" ON "feedback_comment" USING btree ("feedback_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_author_user_idx" ON "feedback_comment" USING btree ("author_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_author_session_idx" ON "feedback_comment" USING btree ("author_session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_parent_idx" ON "feedback_comment" USING btree ("parent_comment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_internal_idx" ON "feedback_comment" USING btree ("is_internal");
