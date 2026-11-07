# SnapQuest Supabase test runbook

This runbook separates no-charge local verification from read-only production diagnosis. Do not incur paid service usage to perform development checks. Never paste invitation tokens, email magic links, service-role keys, or private photo URLs into notes or bug reports.

> **Migration status (November 7, 2026):** Production history records migrations 001–024 and targeted 026–028. Read-only checks confirm all public tables have RLS and anon function grants match the approved public RPC allowlist. The owner chose to retain diagnostic events beyond 365 days, with no maximum duration set. Migration 025 is a no-op and 029 removes any earlier pruning implementation. Development verification uses only the ephemeral Supabase stack in GitHub Actions; do not create a paid hosted branch. Do not use production for role-specific row/Storage or concurrent destructive tests.

## 1. Public deployment smoke test

Open `https://pskelton0330.github.io/SnapQuest/` on desktop and on the test phone.

After a GitHub Pages deployment, verify the workflow is successful and open a cache-busting URL such as `https://pskelton0330.github.io/SnapQuest/?v=COMMIT_SHA#/` before judging the UI. A normal refresh may continue to use the previous HTML asset manifest. Confirm the signed-in screen contains the expected new text or controls, not only that the public landing page loads.

Expected:

- The SnapQuest home screen loads.
- Browser developer tools show no failed `/SnapQuest/assets/` requests.
- The page URL stays under `/SnapQuest/`; it must not redirect to localhost.

## 2. Supabase configuration checks

Open the [project Auth URL Configuration](https://supabase.com/dashboard/project/ykfkwczcomkhxaraqpuq/auth/url-configuration):

- Site URL: `https://pskelton0330.github.io/SnapQuest/`
- Redirect URL: `https://pskelton0330.github.io/SnapQuest/**`
- Local redirects may also include `http://127.0.0.1:5173/**` and `http://localhost:5173/**`.

In [Authentication → Providers](https://supabase.com/dashboard/project/ykfkwczcomkhxaraqpuq/auth/providers):

- Email is enabled.
- Anonymous sign-ins are enabled.

In SQL Editor, verify the progress RPC exists:

```sql
select to_regprocedure('public.get_hunt_progress(uuid)') is not null as progress_rpc_available;
```

The result must be `true` before testing progress bars.

## 3. No-charge development verification

Run the repository checks locally; they use synthetic data and do not connect to Supabase:

```powershell
npm.cmd test
npm.cmd run test:e2e
npm.cmd run lint
npm.cmd run build
```

For database and authorization checks, use the [Supabase local stack workflow](https://github.com/pskelton0330/SnapQuest/actions/workflows/supabase-local.yml) in GitHub Actions. It starts an ephemeral local stack, applies migrations, and discards it after the run. It does not create a hosted branch or change production. The test also confirms audit events at 364 and 366 days remain present.

Do not create a hosted Supabase branch or a separate paid project for routine development checks. Hosted Storage HTTP, real email delivery, concurrent clients, and physical phones cannot be proven by the local stack; keep those checks out of development until a no-charge test environment is available.

## 4. Production troubleshooting is read-only

The latest recorded production migration history is migrations `202610280001` through `202611060024`, plus targeted `202611070026` through `202611070028`. Migration `202611070025` is a no-op; `202611070029` removes any earlier audit-pruning behavior. The owner requires audit events to remain beyond 365 days and has not set a maximum. Check the [current test evidence](PRD_V2_TEST_EVIDENCE.md) before investigating a schema error.

Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/ykfkwczcomkhxaraqpuq/sql) only for read-only diagnosis. For example, check whether an RPC is present:

```sql
select to_regclass('public.hunt_templates') as templates_table,
       to_regprocedure('public.start_game_now(uuid)') as start_now_rpc,
       to_regprocedure('public.get_hunt_progress(uuid)') as progress_rpc;
```

If the RPC is missing, stop before running SQL migrations. Confirm the deployed app revision and compare the migration history with the [repository migration files](https://github.com/pskelton0330/SnapQuest/tree/main/supabase/migrations). Validate any repair in the ephemeral CI stack first. Production migration changes require an explicit, separately planned operation; never paste an old migration into the editor to troubleshoot a missing function.

To inspect a hunt’s troubleshooting history as its organizer, use the app’s Hunt diagnostics panel. The following SQL is read-only and should only be run by the project owner for a hunt they administer:

```sql
select created_at, actor_user_id, event_type, outcome, details
from public.audit_events
where hunt_id = 'PASTE-TEST-HUNT-ID-HERE'
order by created_at desc
limit 100;
```

The audit trail records timing and client failure events without invitation tokens, photo paths, or credentials. It is owner-readable and not participant-readable.

## 5. Organizer login

This hosted smoke test is optional during development. Run it only when an already-available test account and service quota can be used without charges; the local and GitHub Actions checks above do not require it.

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
