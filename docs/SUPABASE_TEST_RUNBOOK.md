# SnapQuest Supabase test runbook

Use an isolated test hunt and test email accounts. Never paste invitation tokens, email magic links, service-role keys, or private photo URLs into notes or bug reports.

> **Migration status (November 7, 2026):** The linked production project was checked read-only and has migrations `202610280001` through `202611060022` applied. Source migrations `202611060023` (non-destructive audit validation), `202611060024` (chat pagination), and `202611070025` (365-day audit-event pruning) are not applied there. Test 023/024 on an isolated project before production; 025 also requires explicit owner approval because it deletes older diagnostic rows. The historical setup instructions below apply to an isolated test project only.

## 1. Public deployment smoke test

Open `https://pskelton0330.github.io/SnapQuest/` on desktop and on the test phone.

After a GitHub Pages deployment, verify the workflow is successful and open a cache-busting URL such as `https://pskelton0330.github.io/SnapQuest/?v=COMMIT_SHA#/` before judging the UI. A normal refresh may continue to use the previous HTML asset manifest. Confirm the signed-in screen contains the expected new text or controls, not only that the public landing page loads.

Expected:

- The SnapQuest home screen loads.
- Browser developer tools show no failed `/SnapQuest/assets/` requests.
- The page URL stays under `/SnapQuest/`; it must not redirect to localhost.

## 2. Supabase configuration checks

In Supabase Authentication → URL Configuration:

- Site URL: `https://pskelton0330.github.io/SnapQuest/`
- Redirect URL: `https://pskelton0330.github.io/SnapQuest/**`
- Local redirects may also include `http://127.0.0.1:5173/**` and `http://localhost:5173/**`.

In Authentication → Providers:

- Email is enabled.
- Anonymous sign-ins are enabled.

In SQL Editor, verify the progress RPC exists:

```sql
select to_regprocedure('public.get_hunt_progress(uuid)') is not null as progress_rpc_available;
```

The result must be `true` before testing progress bars.

## 3. Prepare an isolated test project

Use a dedicated Supabase project with synthetic accounts and hunts for hosted Auth, Storage HTTP, PostgreSQL concurrency, RLS, and Realtime tests. Confirm the project name and reference in the dashboard before running SQL. Do not use the production project for destructive, race, or migration experiments.

For a new test project, apply migrations through 024 in filename order through that project’s SQL Editor or the Supabase CLI. Open the [Supabase projects dashboard](https://supabase.com/dashboard/projects), select the test project, and choose **SQL Editor**. For an existing project, compare its migration history and schema first; never rerun migrations blindly. Apply migration 025 only after the owner approves the 365-day policy, then validate its exact prune behavior with synthetic expired audit rows in the test project before any production application.

## 4. Verify the game-management RPCs

The organizer Start Now control requires the game-management RPC from migration 008. In an existing test project, first confirm whether the template tables already exist:

```sql
select to_regclass('public.hunt_templates') as templates_table,
       to_regprocedure('public.start_game_now(uuid)') as start_now_rpc,
       to_regprocedure('public.get_hunt_progress(uuid)') as progress_rpc;
```

If `hunt_templates` is missing, run migration [202610290007_reusable_hunt_templates.sql](https://github.com/pskelton0330/SnapQuest/blob/main/supabase/migrations/202610290007_reusable_hunt_templates.sql) first.

Then run migration [202610290008_game_management.sql](https://github.com/pskelton0330/SnapQuest/blob/main/supabase/migrations/202610290008_game_management.sql), followed by [202610300009_team_progress.sql](https://github.com/pskelton0330/SnapQuest/blob/main/supabase/migrations/202610300009_team_progress.sql) and [202610300010_audit_logging.sql](https://github.com/pskelton0330/SnapQuest/blob/main/supabase/migrations/202610300010_audit_logging.sql).

Use the test project’s SQL Editor, paste each complete file, and click **Run**. Run them in filename order. Do not use this section to change production.

Verify afterward:

```sql
select to_regprocedure('public.start_game_now(uuid)') is not null as start_now_available,
       to_regprocedure('public.get_hunt_progress(uuid)') is not null as progress_available,
       to_regprocedure('public.list_hunt_audit_events(uuid,integer)') is not null as audit_available;
```

All three values must be `true`.

To inspect a hunt’s troubleshooting history as its organizer:

```sql
select created_at, actor_user_id, event_type, outcome, details
from public.audit_events
where hunt_id = 'PASTE-TEST-HUNT-ID-HERE'
order by created_at desc
limit 100;
```

The audit trail records timing and client failure events without invitation tokens, photo paths, or credentials. It is owner-readable and not participant-readable.

## 5. Organizer login

1. Open the public URL on the phone.
2. Select Organizer Login.
3. Request a magic link for a provisioned organizer email.
4. Open the newest email on the same phone.

Expected:

- The link returns to `https://pskelton0330.github.io/SnapQuest/`.
- Safari does not mention localhost, `127.0.0.1`, or an unreachable server.
- The organizer workspace opens.
- Refreshing the page preserves the session.

If the link is wrong, copy only its destination host/path—not the full token—and correct Supabase URL Configuration before requesting another link.

## 6. Create and join a test game

1. Create a test hunt with at least two challenges.
2. Publish it with two teams and individual QR codes.
3. Open Team A’s QR link on phone A and join as `Test A`.
4. Open Team B’s QR link on phone B and join as `Test B`.
5. Refresh both phones and lock/unlock each phone once.

Expected:

- Each phone keeps its identity and assigned team.
- Reopening the invitation does not ask for the name again.
- A participant cannot be silently moved by scanning another team’s QR code.
- The organizer can use `Join this team`, enter Play mode, and return with `Manage game`.

## 7. Active-play and progress test

Start the test game, then submit one photo from Team A.

Expected:

- Team A’s progress increases by one accepted slot.
- Team B’s progress remains unchanged.
- Both phones can see aggregate counts for all teams.
- Neither phone can see rival photo paths, submitter identities, or rival photos during play.
- Replacing a Team A photo does not increase the count a second time.

Submit a second photo, then refresh and briefly disable/re-enable the phone connection.

Expected:

- The count reconciles to the server value.
- The accepted photo remains present.
- No duplicate participant or duplicate submission is created.

## 8. Authorization checks

- A signed-out visitor can view the public landing page but cannot organize a game.
- An anonymous participant cannot open organizer tables or manage another game.
- A participant from another team cannot read rival submissions during active play.
- A second organizer cannot manage the first organizer’s game.

Record the test environment, device/browser, game ID, time, expected result, actual result, and screenshots. Do not record credentials or bearer tokens.

## Current verification boundary

The app, team names/selfies, aggregate progress, chat, winner cards, invitation recovery, and core scoring/review flows are implemented. This runbook describes test setup and core journeys; its mocked-browser and local database suites do not replace live Storage HTTP, concurrent-session, physical multi-phone, real email-link, or screen-reader acceptance. Quick-review policy, server-rendered video, media deletion/retention controls, and AI hunt generation are not implemented in the core launch. See the [PRD v2 checklist](PRD_V2_CHECKLIST.md), [test evidence](PRD_V2_TEST_EVIDENCE.md), and [product roadmap](PRODUCT_ROADMAP.md) for current status.
