CREATE TABLE "feedback_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"feedback_id" text NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_subscription" ADD CONSTRAINT "feedback_subscription_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_subscription" ADD CONSTRAINT "feedback_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sub_email_feedback_idx" ON "feedback_subscription" USING btree ("feedback_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_token_idx" ON "feedback_subscription" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sub_feedback_idx" ON "feedback_subscription" USING btree ("feedback_id");