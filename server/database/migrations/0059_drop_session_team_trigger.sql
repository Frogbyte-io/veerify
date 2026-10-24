-- The session/team lockstep trigger (0005) reads session.active_team_id, which 0058 dropped:
-- every session insert/update failed. Teams are gone, so the invariant no longer exists.
DROP TRIGGER IF EXISTS "session_team_org_lockstep" ON "session";
--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_session_team_org_lockstep();
