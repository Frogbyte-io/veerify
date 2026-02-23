ALTER TABLE "feedback" ADD COLUMN "is_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "feedback_hidden_idx" ON "feedback" USING btree ("is_hidden");