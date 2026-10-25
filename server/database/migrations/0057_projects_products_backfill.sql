-- Projects & products restructure, step 2 of 3: move data off teams.
-- Step 1 (0056) added the new tables/columns; step 3 drops teams.
--
-- Rules:
--  * Every project gets one default product (same name/slug); feedback moves onto it.
--  * Team members become project members of their team's projects (team admin -> project admin).
--  * Team-scoped support data moves to ONE project per team: the project most referenced by the
--    team's inboxes, else the team's oldest project. Teams that own support data but no project
--    get a project created for them.
--  * Marketing usage/suppression/consent move to the team's organization. Team API keys are NOT
--    copied (their encryption is bound to the team id); they must be re-entered at workspace level.

-- Project slugs become unique per organization: rename later duplicates.
WITH ranked AS (
  SELECT id, slug, row_number() OVER (PARTITION BY organization_id, slug ORDER BY created_at, id) AS rn
  FROM project
)
UPDATE project p SET slug = p.slug || '-' || substr(md5(p.id), 1, 4)
FROM ranked r WHERE r.id = p.id AND r.rn > 1;
--> statement-breakpoint

-- Projects for teams that own support data but have no project.
INSERT INTO project (id, organization_id, team_id, slug, name, is_public, submission_mode, access_mode, settings, created_at, updated_at)
SELECT gen_random_uuid()::text, t.organization_id, t.id,
       t.slug || '-support', t.name, false, 'anonymous', 'workspace',
       '{"supportEnabled": true}'::jsonb, now(), now()
FROM team t
WHERE NOT EXISTS (SELECT 1 FROM project p WHERE p.team_id = t.id)
  AND (
    EXISTS (SELECT 1 FROM support_inbox x WHERE x.team_id = t.id)
    OR EXISTS (SELECT 1 FROM contact x WHERE x.team_id = t.id)
    OR EXISTS (SELECT 1 FROM support_company x WHERE x.team_id = t.id)
    OR EXISTS (SELECT 1 FROM canned_response x WHERE x.team_id = t.id)
    OR EXISTS (SELECT 1 FROM support_tag x WHERE x.team_id = t.id)
    OR EXISTS (SELECT 1 FROM sla_policy x WHERE x.team_id = t.id)
    OR EXISTS (SELECT 1 FROM business_hours x WHERE x.team_id = t.id)
    OR EXISTS (SELECT 1 FROM csat_survey x WHERE x.team_id = t.id)
    OR EXISTS (SELECT 1 FROM automation_rule x WHERE x.team_id = t.id)
    OR EXISTS (SELECT 1 FROM support_sending_domain x WHERE x.team_id = t.id)
  );
--> statement-breakpoint

-- Default product per project.
INSERT INTO product (id, project_id, name, slug, description, is_public, sort_order, created_at, updated_at)
SELECT gen_random_uuid()::text, p.id, p.name, p.slug, p.description, true, 0, p.created_at, now()
FROM project p
WHERE NOT EXISTS (SELECT 1 FROM product pr WHERE pr.project_id = p.id);
--> statement-breakpoint

UPDATE feedback f SET product_id = pr.id
FROM product pr WHERE pr.project_id = f.project_id AND f.product_id IS NULL;
--> statement-breakpoint

-- Team members -> project members.
INSERT INTO project_member (id, project_id, user_id, role, created_at)
SELECT gen_random_uuid()::text, p.id, tm.user_id,
       CASE WHEN tm.role = 'admin' THEN 'admin' ELSE 'member' END, now()
FROM project p
JOIN team_member tm ON tm.team_id = p.team_id
ON CONFLICT (project_id, user_id) DO NOTHING;
--> statement-breakpoint

-- One support project per team.
CREATE TEMP TABLE team_support_project AS
SELECT DISTINCT ON (p.team_id) p.team_id, p.id AS project_id
FROM project p
LEFT JOIN (
  SELECT team_id, project_id, count(*) AS refs
  FROM support_inbox WHERE project_id IS NOT NULL GROUP BY team_id, project_id
) r ON r.team_id = p.team_id AND r.project_id = p.id
ORDER BY p.team_id, coalesce(r.refs, 0) DESC, p.created_at, p.id;
--> statement-breakpoint

UPDATE support_company x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE contact x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE contact_identity x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE support_inbox x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE support_inbox_address a SET project_id = i.project_id FROM support_inbox i WHERE i.id = a.inbox_id;
--> statement-breakpoint
UPDATE business_hours x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE sla_policy x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE support_counter x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE conversation x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE conversation_status_event x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE support_tag x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE csat_survey x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE canned_response x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE automation_rule x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE support_metric_daily x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint
UPDATE support_sending_domain x SET project_id = m.project_id FROM team_support_project m WHERE m.team_id = x.team_id;
--> statement-breakpoint

INSERT INTO support_project_settings (project_id, auto_link_feedback, reporting_timezone, created_at, updated_at)
SELECT m.project_id, s.auto_link_feedback, s.reporting_timezone, s.created_at, now()
FROM support_team_settings s JOIN team_support_project m ON m.team_id = s.team_id
ON CONFLICT (project_id) DO NOTHING;
--> statement-breakpoint

-- Team module switches fold into the project's own settings: a module stays on for a project only
-- if it was on at both levels before. Support had no project-level switch, so it inherits the team's.
UPDATE project p SET settings = coalesce(p.settings, '{}'::jsonb)
  || jsonb_build_object(
    'feedbackEnabled', coalesce(tms.feedback_enabled, true) AND coalesce((p.settings->>'feedbackEnabled')::boolean, true),
    'roadmapEnabled', coalesce(tms.roadmap_enabled, false) AND coalesce((p.settings->>'roadmapEnabled')::boolean, false),
    'changelogEnabled', coalesce(tms.changelog_enabled, false) AND coalesce((p.settings->>'changelogEnabled')::boolean, false),
    'marketingEnabled', coalesce(tms.marketing_enabled, false) AND coalesce((p.settings->>'marketingEnabled')::boolean, false),
    'supportEnabled', coalesce(tms.support_enabled, false) OR coalesce((p.settings->>'supportEnabled')::boolean, false)
  )
FROM team t LEFT JOIN team_module_settings tms ON tms.team_id = t.id
WHERE t.id = p.team_id;
--> statement-breakpoint

-- Marketing: team -> organization.
UPDATE marketing_usage x SET organization_id = t.organization_id FROM team t WHERE t.id = x.team_id;
--> statement-breakpoint
DELETE FROM marketing_usage x USING marketing_usage y
WHERE x.organization_id = y.organization_id AND x.period = y.period AND x.metric = y.metric
  AND (x.units < y.units OR (x.units = y.units AND x.team_id > y.team_id));
--> statement-breakpoint
UPDATE marketing_email_suppression x SET organization_id = t.organization_id FROM team t WHERE t.id = x.team_id;
--> statement-breakpoint
DELETE FROM marketing_email_suppression x USING marketing_email_suppression y
WHERE x.organization_id = y.organization_id
  AND (x.email = y.email OR (x.email_hash IS NOT NULL AND x.email_hash = y.email_hash))
  AND (x.created_at > y.created_at OR (x.created_at = y.created_at AND x.team_id > y.team_id));
--> statement-breakpoint
UPDATE marketing_data_consent x SET organization_id = t.organization_id FROM team t WHERE t.id = x.team_id;
--> statement-breakpoint
DELETE FROM marketing_data_consent x USING marketing_data_consent y
WHERE x.organization_id = y.organization_id
  AND (x.updated_at < y.updated_at OR (x.updated_at = y.updated_at AND x.team_id > y.team_id));
--> statement-breakpoint

-- Sessions start without an active project; the server resolves one on the next request.
UPDATE session SET active_project_id = NULL;
