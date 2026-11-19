# SnapQuest production database handoff

Updated: November 19, 2026

## Objective and outcome

The user asked to finish the production database work needed by the deployed SnapQuest UI. That work is complete. Supabase migrations 031–033 were applied to production, the live ledger and resulting schema were verified, and the repository documentation and migration filenames have been aligned to production.

## Deployed app

- Live URL: https://pskelton0330.github.io/SnapQuest/
- Verified deployed revision: `18beded62c73cea3987aaee8b3697118a3b24fe9`
- GitHub Pages workflow run 286 / ID `44567382127` passed its build, browser suite, lint, build, deployment, and deployed-revision smoke check.
- UI PR #3 is merged.

## Production Supabase state

- Project ref: `ykfkwczcomkhxaraqpuq` (`pskelton0330's Project`), region `us-west-2`, status `ACTIVE_HEALTHY`.
- Production migration history was checked through the Supabase connector and directly against `supabase_migrations.schema_migrations`.
- The latest ledger entries are exactly:
  - `202611090030` — `auto_approve_hunt_photos`
  - `202611090031` — `saved_winner_celebrations`
  - `20261119185427` — `restore_photo_review`
  - `20261119185440` — `self_serve_organizer_accounts`
- There is exactly one ledger record for each version above. A transient duplicate display for 031 did not remain in the ledger.
- Migrations 031, 032, and 033 were applied successfully through the Supabase connector. Connector-generated versions for 032 and 033 are reflected in local filenames.
- Migration 032 matched zero production rows for its correction of untouched auto-approved submissions in unfinished hunts.

## Verified schema and policies

- `public.winner_celebration_cards` exists, has RLS enabled, and has three policies.
- The private `winner-cards` bucket accepts PNGs up to 2 MiB; it currently contains zero objects. Read/insert/update/delete Storage policies are present.
- `submissions.approval_status` defaults to `pending`.
- `can_manage_winner_card`, `ensure_my_organizer_profile`, and `submit_hunt_photo` are security-definer functions granted to `authenticated`, not `anon`.
- `ensure_my_organizer_profile()` is for verified, non-anonymous users.
- Supabase health advisor returned no lints. Security and performance advisor reports include broader items for separate assessment: invitation-table policy configuration; the approved anonymous public RPC allowlist; authenticated security-definer RPCs; and unindexed foreign keys. No new anonymous grants were found for the functions listed above.

## Repository records

- Checkout: `C:\Users\Pat\Projects\SnapQuest-remote-check`
- Branch: `ux/snapquest-ui-test-deploy-2026-11-19`
- HEAD at handoff: `e7c6e69c9de0cc1e3741cf943c0e9872f94ae149`
- Migration filenames now match the remote versions, including `20261119185427_restore_photo_review.sql` and `20261119185440_self_serve_organizer_accounts.sql`.
- `docs/SUPABASE_TEST_RUNBOOK.md` and `docs/PRD_V2_TEST_EVIDENCE.md` contain the current migration status. The November 7 automated evidence remains explicitly historical.
- The handoff file itself and these documentation/filename updates are local changes on the branch. No production secrets or participant data were recorded.

## Resume guidance

No migration from this batch remains to be applied. Continue from the current checkout and inspect `git status` before unrelated edits. Future production schema changes should be planned against the verified migration ledger, applied through the Supabase migration workflow, and recorded in the runbook and evidence file. Do not use production for destructive or multi-role acceptance testing.
