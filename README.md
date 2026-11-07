# SnapQuest — Family Photo Scavenger Hunt

SnapQuest is a responsive React, TypeScript, and Vite app backed by Supabase Auth, Postgres, Realtime, and private Storage. Organizers create and schedule hunts, assign teams, share QR invitations, manage the lobby, start or end play, review photos, and finalize scores. Participants join without passwords, submit team photos, follow team progress, chat, and view results.

- **Live app:** [https://pskelton0330.github.io/SnapQuest/](https://pskelton0330.github.io/SnapQuest/)
- **GitHub repository:** [https://github.com/pskelton0330/SnapQuest](https://github.com/pskelton0330/SnapQuest)
- **Current implementation, release evidence, and open acceptance gaps:** [PRD v2 checklist](docs/PRD_V2_CHECKLIST.md), [test evidence](docs/PRD_V2_TEST_EVIDENCE.md), and [improvement backlog](docs/reviews/2026-11-06-improvement-backlog.md).

## What is implemented

- Organizer email magic-link authentication and an authenticated hunt workspace.
- Scheduled lobby setup, Start Now, hunt timing controls, teams, names, QR invites, roster, and team selfies.
- Participant invite recovery, anonymous sessions, waiting lobby, mobile photo capture, private uploads, and replacement recovery.
- Team and all-team progress, a synchronized timer, and organizer/participant hunt chat.
- Organizer photo review, optional voting, server-calculated scores, tied ranks, and finalized results.
- Branded winner celebration cards with download and native share-sheet support.
- Privacy-limited diagnostics and GitHub Actions validation/deployment to GitHub Pages.

The browser-based winner card is the current sharing feature. Server-rendered video, licensed music, direct posting to social networks, and AI hunt generation remain later roadmap work. See [Product roadmap](docs/PRODUCT_ROADMAP.md).

## Local development

Use Node.js 20.19+ or 22.12+. On Windows with PowerShell script execution disabled, use `npm.cmd`.

```powershell
git clone https://github.com/pskelton0330/SnapQuest.git
cd SnapQuest
npm.cmd install
Copy-Item .env.example .env.local
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. Never put a database password or service-role key in a `VITE_` variable. Keep `.env.local` private; it is git-ignored.

Run the app and checks:

```powershell
npm.cmd run dev
npm.cmd test
npm.cmd run test:e2e
npm.cmd run lint
npm.cmd run build
```

The development-only local workspace is available at `http://localhost:5173/#/dev/browse`. It uses browser storage and sample data; it does not create real Supabase hunts, invitations, uploads, or scores. Production routes use the authenticated Supabase workspace.

## Supabase configuration and migrations

The linked production project is `ykfkwczcomkhxaraqpuq`. Its [Supabase dashboard](https://supabase.com/dashboard/project/ykfkwczcomkhxaraqpuq) contains the [Auth URL configuration](https://supabase.com/dashboard/project/ykfkwczcomkhxaraqpuq/auth/url-configuration) and [SQL Editor](https://supabase.com/dashboard/project/ykfkwczcomkhxaraqpuq/sql). Dashboard settings are separate from SQL migrations.

For local or dedicated test projects, configure the app URL and allowed redirects, enable anonymous sign-ins for participants, and configure organizer email links. The production Pages URL is `https://pskelton0330.github.io/SnapQuest/`; local Vite normally uses `http://127.0.0.1:5173/`.

The repository contains migrations through `202611060024`. A read-only production migration-history check on November 6, 2026 verified migrations through `202611060022`; migrations `202611060023` and `202611060024` were not applied. Migration 023 prunes diagnostic records older than 365 days and requires explicit operator authorization before production application. Do not apply local migrations to production just because they exist in this repository. First inspect the [PRD v2 test evidence](docs/PRD_V2_TEST_EVIDENCE.md) and [migration runbook](docs/SUPABASE_TEST_RUNBOOK.md), and validate hosted changes in an approved test project.

Participant photos and selfies use private storage and short-lived signed URLs. Organizer provisioning and production database changes require trusted Supabase access; the browser uses only the publishable key.

## Build and test

The test suite includes unit/domain checks, PGlite PostgreSQL migration and authorization checks, and Playwright browser coverage for desktop and mobile viewports. These automated checks do not replace real Supabase Storage HTTP, concurrent PostgreSQL, physical-device, real email-link, or screen-reader acceptance. Current results and remaining gaps are recorded in the [test evidence](docs/PRD_V2_TEST_EVIDENCE.md).

GitHub Actions validates changes and publishes the Pages app. Confirm a successful workflow and verify the live `build-info.json` before treating a new commit as deployed. The current checklist and release links are maintained in the [improvement backlog](docs/reviews/2026-11-06-improvement-backlog.md).
