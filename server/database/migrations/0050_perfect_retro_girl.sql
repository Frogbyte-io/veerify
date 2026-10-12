CREATE TABLE "feedback_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"feedback_id" text,
	"project_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"requested_content_type" text NOT NULL,
	"requested_size_bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"kind" text NOT NULL,
	"width" integer,
	"height" integer,
	"uploaded_by_user_id" text,
	"uploaded_by_session_id" text,
	"status" text NOT NULL,
	"attached_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_attachment" ADD CONSTRAINT "feedback_attachment_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_attachment" ADD CONSTRAINT "feedback_attachment_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_attachment" ADD CONSTRAINT "feedback_attachment_uploaded_by_session_id_anonymous_session_id_fk" FOREIGN KEY ("uploaded_by_session_id") REFERENCES "public"."anonymous_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_attachment_feedback_idx" ON "feedback_attachment" USING btree ("feedback_id");--> statement-breakpoint
CREATE INDEX "feedback_attachment_cleanup_idx" ON "feedback_attachment" USING btree ("attached_at","created_at");--> statement-breakpoint
CREATE INDEX "feedback_attachment_user_idx" ON "feedback_attachment" USING btree ("uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "feedback_attachment_session_idx" ON "feedback_attachment" USING btree ("uploaded_by_session_id");