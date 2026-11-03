# SnapQuest — Family Photo Scavenger Hunt

SnapQuest is a responsive React, TypeScript, and Vite app with Supabase Auth, Postgres, Realtime, and private Storage. Organizers create venue-based hunts, invite teams with QR codes, review photos, and publish scores. Participants join without passwords, play on a schedule, and submit team photos from a phone or computer.

## Local development

### v1.2 Phase 1 preview

While Vite is running, open `http://localhost:5173/#/dev/browse` or use **Open Organizer Preview** on the home screen. The preview has Browse Hunts, My Hunts, My Games, and Create a Hunt. Hunt and game detail URLs can be bookmarked and refreshed. These routes are enabled only in development.

The shared domain model and repository contract live in `src/lib/workspace.ts`; the local adapter uses `snapquest-development-workspace-v1` in browser storage. Original `snapquest-local-development-drafts` are imported once as personal templates, without modifying the original stored drafts. Sample public hunts are clearly labeled. The preview does not publish content, access Supabase tables, or create real invitations, uploads, or scores. Each local game snapshots its source hunt independently.

The later sections describe the Supabase adapter and guided editor. Connecting the shared preview to Supabase remains later work. Browser-local game setup and timing controls are now available. The existing authenticated Supabase workspace and participant routes are retained during this foundation phase.

Run `npm.cmd test`, `npx.cmd tsc -b`, and `npm.cmd run lint` on Windows. Tests use Node's `--test-isolation=none` to avoid child-process spawning restrictions on managed computers; use a current Node version that supports that flag. Production bundling may still encounter the workstation's existing esbuild `spawn EPERM` restriction.

### v1.2 Phase 2 template foundation

Migration `202610290007_reusable_hunt_templates.sql` adds reusable templates and safe creator display profiles. Existing `hunts` rows continue to be game instances; their IDs, participants, invitations, photo paths, votes and scores remain in place. Legacy rows are linked to personal templates; nothing historical is automatically published. New originals saved through `save_hunt_template` default to public; `copy_hunt_template` always creates a personal copy. Game creation snapshots the selected template and gives its game items independent IDs.

Public discovery uses `list_hunt_templates(false)`, which returns only safe metadata and challenge documents. Raw creator mappings and template tables are not granted to public visitors. Writes require a provisioned organizer and go through validated RPCs. `set_hunt_creator_name` sets a chosen public display name; it never derives a name from an email. Completed-play counting is deferred to Phase 5.

`src/lib/supabaseWorkspace.ts` provides the future authenticated data adapter. It is not connected to the local preview yet. The local preview includes Customize Hunt, saves personal copies, and continues using browser storage.

Before applying migration 007 to a Supabase project, audit the deployed 001–006 schema/functions/policies against these source files and capture counts/IDs for existing game and child records. Apply 007 in order, compare those original rows afterward, verify legacy templates are personal, and exercise anon/participant/other-organizer boundaries with real Supabase sessions. No migration was automatically applied to the main project during local UI refinement. Avoid dropping the new tables to roll back: the application can continue using the legacy workflow while the additive columns remain.

The database suite executes migrations 001–008 in PGlite (local PostgreSQL), with minimal test fixtures for Supabase Auth and Storage metadata. It tests RLS/grants, RPC authorization, atomic validation failures, repeatable backfill, historical data preservation, public/private copies, safe attribution, and independent game snapshots. It does not emulate Supabase email, JWT verification, Storage HTTP APIs or Realtime. Invitation generation is exercised with the PGlite pgcrypto extension. These require a later Supabase integration run.

### v1.2 Phase 3 discovery and guided editor

The local preview includes title search, venue/creator filters, newest/popular sorting, and completed-preview-game counts. Preview counts are derived only from completed local game IDs, never views or scheduled games. The authoritative Supabase popularity ledger remains Phase 5 work.

Create a Hunt now uses Details, Challenges, optional Paste a List, and Review and Save. Challenge ideas come from the preview's existing templates. Individual rows support wording/instructions, ordering, whole-number points, and removal. Bulk import accepts one line per challenge, skips blank lines, preserves wording by default, optionally removes leading list markers when explicitly selected, and rejects invalid or oversized batches without partially importing them. All rows default to one point.

My Hunts provides Edit Hunt for owned templates. Customize Hunt creates a personal copy and opens its editor. Personal copies remain personal, and changing a template leaves existing game snapshots intact. Original new hunts default to the shared preview library; the user can choose personal visibility. Unsaved editor content, the current step, and unimported pasted text are kept in browser storage under `snapquest-editor-v1-*`. Saving removes the corresponding editor cache.

After saving, Create Game enters a separate setup draft. Setup supports scheduled lobby creation or a confirmed immediate start. Selecting a hunt never starts gameplay by itself. No Phase 3 changes have been applied to Supabase or deployed publicly.

### Supabase development setup

1. Install Node.js 20.19+ or 22.12+.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never put the database password or a secret/service-role key in a `VITE_` variable.
4. In Supabase Auth URL settings, set the production Site URL to `https://pskelton0330.github.io/SnapQuest/` and allow `https://pskelton0330.github.io/SnapQuest/**`. For local testing, also allow `http://127.0.0.1:5173/**`. Enable anonymous sign-ins for participant sessions. Configure the email link template/site URL for organizer sign-in. If the Site URL remains localhost, phone magic links will return to a server that the phone cannot reach.
5. Apply the migrations in `supabase/migrations/` in filename order in Supabase SQL Editor or through the Supabase CLI.
6. Run `npm install`, then `npm run dev`.

### Windows with PowerShell script execution disabled

Use `npm.cmd` instead of `npm`, or double-click `Start SnapQuest.cmd`. Keep its terminal open while using the local site.

```powershell
cd "C:\path\to\family-photo-hunt"
npm.cmd install
npm.cmd run dev
```

## Features

- Organizer email magic-link authentication and organizer-only workspace.
- Private reusable challenge library and venue hunt drafts with suggested safety/photo rules.
- Scheduled hunt setup, organizer-defined or balanced team assignments, QR invitations, roster and invite rotation.
- Anonymous participant sessions, waiting room, team roster, server-synchronized countdown, and active challenge list.
- Phone camera/file photo uploads, client-side resizing and metadata removal, private Storage, and one replaceable submission per team/challenge.
- Organizer photo review with approve/reject decisions; team voting for approved photos when enabled.
- Server-calculated scores, tied ranks, and a final participant leaderboard.
- Hash-based app routes are compatible with later static hosting under a project subpath. Deployment is intentionally not configured yet.

## Supabase setup and security

- Apply migrations `202610280001` through `202610280006` in order. Migration 001 creates the organizer/challenge foundation; 002 adds venue hunts; 003 adds teams and invitation/session functions; 004 adds reuse of library items; 005 adds submissions and private photo Storage; 006 adds voting and final scores.
- PRD v1.1 records migrations 001–006 as applied historically. That is documentary evidence, not a fresh remote inspection. Migrations 007–008 remain staged locally and have not been applied during this improvement pass. Audit the live schema before reconnection.
- Organizer profile rows are not self-service. Provision an organizer only from a trusted Supabase admin context.
- Anonymous sign-in must be enabled in Supabase Auth. Participant accounts are anonymous Auth users; clearing browser data loses the device session, so participants should keep their invitation link and device available during a hunt.
- Invitation QR values are random bearer tokens; only SHA-256 hashes are stored in Postgres. Replacing invite codes invalidates earlier codes.
- Photos stay in a private bucket. RLS and SQL functions authorize uploads, reads, removal, review, voting, and scoring. The browser receives only the publishable key; no service-role secret is needed in the app.
- Supabase dashboard configuration for anonymous Auth and redirect URLs is separate from SQL migrations and must be set before testing participant registration.

## Commands

- `npm run dev` — local development server
- `npm run build` — TypeScript validation and production bundle
- `npm run lint` — static lint checks
- `npm test` — domain, adapter, scoring and local PostgreSQL authorization/migration tests

## Current verification limits

TypeScript, lint, and scoring tests can run locally. On some locked-down Windows machines, Vite/esbuild cannot start its helper process and `npm run build` fails with `spawn EPERM`; this is a local execution-policy restriction, not a TypeScript diagnostic. No GitHub Pages deployment has been made.

## Organizer usability improvement batch 2026-11-01

Hunt details and the saved-editor screen use **Create Game**, separating selection/setup from the confirmed **Start Now** action inside a game. Game management shows Setup, Lobby, Active, Review and Completed orientation, current-stage guidance, and shortcuts to timing, rosters and invitations. Review/completed local previews explicitly identify that real photos/results remain in the retained Supabase workflow.

The existing editor now distinguishes **Publish Hunt**, **Save Personal Copy**, and **Save Personal Hunt**. Public wording warns that the reusable challenge content is discoverable; private game information is separate. Unfinished work is automatically cached in this browser and can be kept when closing the editor. This is not a server-saved draft capability. Published/personal templates still use the existing visibility model, without a new schema state.

Bulk entry trims whitespace and skips empty lines. Numbering and punctuation are preserved by default; an unchecked option allows removing list markers. Imported rows open in the existing challenge editor for review before saving.

Phase 4 migration 008 provides organizer-authorized setup, Start Now, rescheduling and extensions, with server clock checks and row locks; these are staged functions, not remote-verified behavior. Local preview registration, QR codes, clocks and roster synchronization are browser-local simulations. Links do not share local data across physical devices. Timing-change history is not implemented.

See `IMPLEMENTATION_REVIEW.md` for the evidence-based gap assessment and `CHANGELOG.md` for this batch. No migrations, security-policy changes, remote writes or deployment were performed. Review the batch before proceeding to timing/photo/scoring correctness or presentation improvements.

## PRD v2 controlling requirements and first batch

The consolidated November 2 document is `docs/SnapQuest_Revised_PRD_v2.0.md`. It defines the version-one web product, not a new app rebuild. See `docs/PRD_V2_CHECKLIST.md`, `docs/PRD_V2_PLAN.md`, and `docs/PRD_V2_TEST_EVIDENCE.md` for requirement status, decision gates, actual test evidence and physical-phone scenarios. Older manual-review statements describe existing compatibility behavior; new quick-review defaults remain to implement explicitly per game.

The first batch improves existing Supabase invitation/session continuity: Auth restores before joining, permanent users retain their identity, existing memberships resume without name reentry, and restoration failures show retry. Foreground/online returns refresh authoritative context. The local preview still uses its separate browser simulation; these changes do not reconnect it to Supabase or implement the host switch. No new migration is required.
