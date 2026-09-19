DROP INDEX "sla_target_policy_metric_priority_idx";--> statement-breakpoint
DELETE FROM "sla_target" AS duplicate
USING "sla_target" AS keeper
WHERE duplicate."priority" IS NULL
  AND keeper."priority" IS NULL
  AND duplicate."sla_policy_id" = keeper."sla_policy_id"
  AND duplicate."metric" = keeper."metric"
  AND duplicate."id" > keeper."id";--> statement-breakpoint
CREATE UNIQUE INDEX "sla_target_policy_metric_catch_all_idx" ON "sla_target" USING btree ("sla_policy_id","metric") WHERE "sla_target"."priority" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "sla_target_policy_metric_priority_idx" ON "sla_target" USING btree ("sla_policy_id","metric","priority") WHERE "sla_target"."priority" is not null;
