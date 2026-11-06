# SnapQuest remediation plan

Date: November 6, 2026
Source audit: [Deep review](2026-11-06-deep-review.md)
Audit baseline: `9821300ca779bcd18f64fc9d1f94622674f484de`

## Goal

Resolve the confirmed reliability, data-integrity, security-boundary, and usability findings in small reviewable changes. Keep the production application, database behavior, and user-facing instructions aligned. Preserve guest identity, hunt ownership, team privacy, and finalized results.

This is a plan only. No application code, schema, or production configuration is changed by this document.

## Before implementation

1. Recheck all 20 findings against the current `main` checkout. The audit was made at an earlier commit; mark each item **open**, **partially fixed**, **fixed**, or **not reproduced**, and attach current source/migration evidence.
2. Preserve the original dated audit. Record corrections and implementation status in this plan or a dated remediation log rather than rewriting historical results, except to correct demonstrably inaccurate audit claims.
3. Confirm the current production deployment commit and database migration state. Use links to the relevant GitHub run and Supabase migration history in the execution log; do not infer that a local commit is live.
4. Keep all repro data isolated from real hunts. Use local PGlite for SQL behavior and a dedicated Supabase test project for hosted Auth, Storage HTTP, realtime, and multi-device cases.

## Work order

### Phase 0 — Establish a reliable release path

**Finding:** R20, deployment concurrency.

Separate pull-request validation from production deployment concurrency. Ensure a pull-request run cannot cancel a main-branch publish; serialize publish operations and verify the served revision after deployment. Record the intended commit in a small build/version endpoint or manifest and smoke-check a routed page after publishing.

**Exit gate:** A pull request cannot cancel a production publish. Two quick main pushes result in the newest successful build being served. The deployment run and served version both identify that commit.

### Phase 1 — Repair database invariants and authoritative results

**Findings:** R03, R04, R07, R08, R09.
**Dependency:** R09 must be enforced before changing R05 media cleanup behavior.

1. Make stored `final_scores` authoritative for completed organizer and participant views and celebration data. Normalize provisional vote RPC data at one typed boundary and make helper ranking match the SQL dense-rank contract (R03).
2. Make review mutations require the review lifecycle state and use a consistent hunt-row lock order with finalization. Define retry-safe finalization semantics (R04).
3. Repair selfie submitter attribution so moving a member does not violate the team-selfie foreign key or change which team's selfie is retained (R07).
4. Add explicit null-safe lifecycle and authorization checks to the review-gallery RPC so a manual-start lobby cannot reveal challenge data before start (R08).
5. Prevent ordinary Storage cleanup from deleting paths referenced by submissions or team selfies. Keep intentional deletion as a separate coordinated operation (R09).

Use additive migrations. Review SQL permissions, state transitions, references, and lock order locally first. Verify actual Storage HTTP policies in a dedicated project before considering production application.

**Exit gate:** Regression coverage proves the invalid pre-start gallery request is denied, finalized decisions cannot change, retries do not alter final results, selfie moves preserve attribution, referenced objects cannot be removed through cleanup, and organizer/player/card scores agree exactly.

### Phase 2 — Restore the main guest and organizer journeys

**Findings:** R01, R02, R10.

Implement a real public-home route for anonymous sessions while retaining participant identity (R01). Correct the natural-expiry path so an organizer can explicitly start photo review without pretending the hunt was manually ended (R02). Make play/manage switching depend on the current hunt's actual owner and participant memberships, and keep the selected hunt synchronized through direct links, refresh, and browser history (R10).

**Exit gate:** A guest can join, return home, and resume the same participant after refresh. A naturally expired hunt reaches review, finalization, and participant results. Owners who also play can switch both ways to the correct hunt/team; non-owner players do not get misleading organizer actions.

### Phase 3 — Make media, invitations, and live views recoverable

**Findings:** R05, R06, R11, R12, R13, R17.
**Dependencies:** Apply R09 protection before tightening cleanup paths in R05/R06. Use R03's authoritative result contract in R13.

Track upload, server acceptance, and preview as separate outcomes. Never delete an object after an accepted or uncertain commit until server state proves it is unreferenced (R05/R06). Design organizer invitation recovery across devices without displaying revoked codes or relying on localStorage as the source of truth (R11). Refresh lobby data from other devices and distinguish absent, saved, and temporarily unavailable selfies (R12). Reconcile review/vote data and renew expired signed URLs (R13). Coalesce overlapping requests, prevent stale responses from overwriting newer state, retain valid previews, and scope errors to the operation (R17).

R12 correction: a local move already updates both the flat roster and grouped team cards because both consume `managedParticipants`; only cross-device freshness remains missing.

**Exit gate:** Fault-injection covers lost responses, signing failure, and replacement failure. Accepted media remains intact. Two-device membership, selfie, review, and voting changes converge without manual reload. Expired previews recover. Invitation state remains correct after storage clearing and on a second organizer device. Request counts remain bounded during unchanged polling.

### Phase 4 — Finish lifecycle UX, messaging, editing, and diagnostics

**Findings:** R14, R15, R16, R18, R19.

Define tie and no-score celebration rules from authoritative results; make the intended share journey available to participants and organizers (R14). Give chat clear reconnect, history, unread, read-only, and lifecycle states; verify it does not delay hunt controls (R15). Bring saved-draft editing and pre-publish review into the authenticated production workspace, preserving started-game snapshots (R16). Add privacy-safe operation IDs and useful outcome stages for photo, selfie, review, and finalization paths (R18). Simplify the screen hierarchy, feedback, accessibility, and phone layouts based on the lifecycle contract in the audit (R19).

**Exit gate:** Tie, zero-score, missing-selfie, and long-name cards are honest and readable. Chat reconnects and explains when sending is unavailable. Drafts can be reopened and corrected in production. Diagnostic traces contain no tokens, signed URLs, image data, or message bodies. A first-time phone user completes the defined core tasks without coaching.

## Build-and-test method for each change

1. **Baseline:** Check `git status`, current branch/commit, production deployment, and relevant migration state. Confirm no unrelated local edits will be included.
2. **Reproduce:** Create a focused regression case before or alongside the fix. Use actual migrations for SQL behaviors and the production UI path for screen/route behaviors. Record what was directly observed versus inferred.
3. **Implement narrowly:** One coherent behavior per change. Add forward-only migrations for database repairs. Keep authorization and server-side lifecycle checks authoritative; client UI state is not a security control.
4. **Verify locally:** Run the focused regression test, full `npm.cmd test`, `npm.cmd run lint`, and `npm.cmd run build`. Inspect the diff and migration SQL. For UI work, exercise narrow phone widths and keyboard navigation; use browser automation where available.
5. **Verify hosted behavior when applicable:** Apply migrations only to the dedicated test project first. Check Supabase logs, Storage HTTP, realtime, and multi-device behavior. Use production only for non-destructive read-only verification unless a separately reviewed release is explicitly scheduled.
6. **Commit and publish:** Keep commits small, push completed changes to GitHub, monitor the matching Actions run, and verify the hosted app serves the intended commit. Never describe a pushed change as live before checking deployment.
7. **Update the ledger:** Mark finding status with commit, migration, test evidence, deployment URL/run, and remaining limits. Do not mark fixed based only on code presence or a green build.

## Release acceptance journeys

- Guest join → return home → resume after refresh without losing participant identity.
- Organizer who plays → switch to the correct team game → return to management for that hunt.
- Manual and scheduled hunts → team lobby → start → timer expiry → photo review → finalize → identical results on all views.
- Pre-start manual lobby → challenge details remain hidden through every RPC and Storage path.
- Selfie/photo accepted → preview failure or lost response → accepted media remains and the UI reports a recoverable state.
- Move a selfie submitter → the original team's image and historical attribution remain valid.
- Finalized results → all later review writes fail; referenced media cannot be removed by cleanup.
- Voting and ties → stored totals, displayed ranks, and celebration winners agree.
- Two devices → roster, selfie, votes, and review decisions converge; signed URLs recover after expiry.
- Pull request and rapid main pushes → PR cannot cancel production publishing; served commit is verified.
- Mobile usability → complete join, take photo, copy invite, switch modes, and review tasks at 320/375/390 px and 200% text zoom.

## Execution rule

Start with Phase 0 and the current-state recheck. Work through phases in order, but split each phase into small independently reviewable changes. If a current finding is already fixed, verify its acceptance gate and record the evidence instead of reimplementing it. Keep video generation, AI hunt generation, and other premium roadmap work deferred until this reliability plan is complete.
