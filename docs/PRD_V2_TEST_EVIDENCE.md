# Test evidence and real phone checklist

Date: November 3, 2026. Environment: managed Windows workstation with the production Supabase project linked through the Supabase CLI, plus live browser/phone testing. Local PGlite evidence remains separate from live evidence.

## Live production smoke evidence

The production migration set `202610280001` through `202611030011` was applied to project `ykfkwczcomkhxaraqpuq` and verified in the remote migration history. A controlled hunt was then completed through the public app:

- `start_game_now(uuid)` was recorded as a successful backend audit event.
- The hunt reached `completed` with an `ended_at` timestamp.
- Five challenge items existed; two photo submissions were recorded and both were approved.
- Final scores were stored server-side: Team Red ranked first with 2 points and Team Blue ranked second with 0 points.
- The PostgREST schema cache was refreshed after migration deployment.
- Reschedules, added time, early ending, and transition into review now write privacy-safe server-side audit events; their live function definitions were verified after deployment.

This confirms the core live path—organizer setup, immediate start, participant capture, organizer review, and server-calculated final scoring—for this controlled scenario. It does not replace the adversarial, reconnect, multi-device, media-retention, or montage acceptance scenarios below.

The current reliability batch adds client-side persisted cleanup retries for replaced photos and submission reconciliation after an uncertain RPC response. Automated coverage now totals 52 passing tests; this behavior still requires physical-device interruption and multi-device acceptance testing.

The team identity batch adds a unique pre-start team-name update, one private current team selfie, authorized replacement, and top-of-screen time/all-team accepted-photo progress bars. Automated coverage now totals 53 passing tests; the new migration and UI still require physical-device synchronization testing.

## Automated evidence for session batch

- npm.cmd test: 47 tests passed (39 retained plus seven session-helper tests and one membership/ownership database regression).
- TypeScript stage of npm.cmd run build passed. npm.cmd run lint passed without warnings.
- Production build attempted: Vite/esbuild failed with spawn EPERM. No successful bundle is claimed.
- New helper tests cover existing guest/permanent identities, restore-before-create ordering, no guest creation during passive rejoin, no anonymous fallback on restoration errors, only known name-required responses opening registration, uncertain-response retry with same identity, and invalid names causing no writes.
- New PGlite regression: permanent owner joins, rescans the other team QR without reassignment/duplication, resumes after invitation rotation and early closeout, retrieves current review context. A second organizer may join as a player but cannot start the owner's game. These sequential database tests do not prove multi-connection concurrency or real JWT behavior.
- App hydration UI and foreground listeners type-check but have not had automated DOM/real-phone verification. Component lifecycle is not covered by helper tests alone.

## Browser and remote checks

No browser or physical-device checks performed for this batch. Existing browser tests from November 1 are historical, not verification of these changed session paths. PGlite runs are local database tests, not a live Supabase integration run. Actual email delivery, anonymous provider settings, Storage HTTP, token refresh and Realtime behavior remain unverified.

## Priority manual protocol

Use an approved isolated backend and controlled permanent owner A, organizer B, and guest phone sessions. Record device, OS/browser versions, origin, test environment, game ID, time, expected/actual outcomes and evidence. Never log invitation tokens or credentials. Do not use broad cleanup against production data.

1. A opens a team invitation while already authenticated; verify Auth user ID stays unchanged. Reopen invitation after refresh. Do not describe full Play/Manage UI as implemented yet.
2. Guest joins once, scans another team QR, locks for longer than a normal refresh interval, switches apps, refreshes and reopens the same browser. Verify one participant row, same ID/team and current server phase.
3. Interrupt connectivity during restoration and return online. Verify retry UI and no new anonymous user. Check accepted photo remains correct after refresh.
4. Repeat after deadline, invitation rotation and finalization; existing members resume permitted views while unrelated new joins fail. Verify B cannot manage A's game.
5. Clear test browser site data or use a different origin/device. Verify honest lost-credential guidance; never recover by name alone.

## Full PRD acceptance register

All physical-device/end-to-end scenarios below remain NOT RUN. Partial local evidence is recorded above and in PRD_V2_CHECKLIST.md; it is not a substitute for these acceptance runs.

| Test | Scenario | Expected outcome | Current device result |
| --- | --- | --- | --- |
| AT-01 | Signed-out visitor browses and attempts to host | Public templates accessible; account required to create/start game. | NOT RUN |
| AT-02 | Two organizer accounts access each other's game IDs | Private data/actions denied across ownership boundaries. | NOT RUN |
| AT-03 | Team-specific QR registration | Correct game/team; name required once; no email/password needed. | NOT RUN |
| AT-04 | Concurrent shared-QR joins and repeated submissions | Persisted balanced assignment; one participant per identity/game. | NOT RUN |
| AT-05 | Rescan another team's QR after joining | No silent reassignment or duplicate participant. | NOT RUN |
| AT-06 | Owner taps Join this team and switches Play/Manage | Same permanent identity/team retained; management still available. | NOT RUN |
| AT-07 | Another organizer joins only as a participant | No management access to the host's game. | NOT RUN |
| AT-08 | Lock/unlock, app switch, refresh, and reopen same browser | Return to correct game/team without name reentry or new identity. | NOT RUN |
| AT-09 | Resume after deadline or after finalization | Authoritative phase restored; no expired upload controls. | NOT RUN |
| AT-10 | Temporary connection loss / expired access token refresh | Reconnect without treating transient failure as a new registration. | NOT RUN |
| AT-11 | Cleared storage or different browser | Honest recovery path; no identity claim based only on a name. | NOT RUN |
| AT-12 | Selfie submitted/replaced or missing | One team image; private; no points/progress; documented missing-image behavior. | NOT RUN |
| AT-13 | Scheduled start, Start Now, reschedule, Add Time, End Early | Server-consistent transitions; duplicate start does not reset clock. | NOT RUN |
| AT-14 | Device clock is deliberately wrong | Server rules unchanged; displayed time reconciles. | NOT RUN |
| AT-15 | iPhone/Android capture with representative images | Correct orientation/fit; supported formats; clear unsupported-file errors. | NOT RUN |
| AT-16 | Upload succeeds but response is interrupted | Reconcile acceptance without duplicate submission or false failure. | NOT RUN |
| AT-17 | Replacement fails or two teammates race | Prior accepted image protected; one final active image and cleanup path. | NOT RUN |
| AT-18 | Upload finishes after deadline or early end | Consistent rejection; no client-timestamp exception. | NOT RUN |
| AT-19 | Multiple teams submit and one replaces a photo | All progress bars update; replacement does not increase count. | NOT RUN |
| AT-20 | Rival participant probes submission/progress endpoints | Counts permitted; rival photos/answers/paths denied during play. | NOT RUN |
| AT-21 | Quick-review game with valid, missing, and rejected entries | Non-rejected accepted entries earn configured points on explicit finalization. | NOT RUN |
| AT-22 | Legacy manual-review game retains pending entries | Legacy finalization behavior preserved; no retroactive rule change. | NOT RUN |
| AT-23 | Equal final totals | Shared ranks; no forced speed tiebreak. | NOT RUN |
| AT-24 | Optional voting: zero votes, self-vote, duplicate, rejected photo | Correct eligibility; no zero-vote award; one effective team vote. | NOT RUN |
| AT-25 | Repeated finalize / network retry | Same results; one completed-play count and one logical montage job. | NOT RUN |
| AT-26 | Timer expires but organizer has not finalized | No montage generation yet. | NOT RUN |
| AT-27 | Finalize while renderer unavailable | Results visible; job failure/pending explicit and safely recoverable. | NOT RUN |
| AT-28 | Render valid game with absent selfie and tied winners | Branded real video, correct placeholders, eligible photos, correct standings. | NOT RUN |
| AT-29 | Unapproved/disabled music selected | Excluded from export; approved tracks retain required attribution. | NOT RUN |
| AT-30 | Guest closes browser and returns after completion | Read-only results and ready reel available during authorized window. | NOT RUN |
| AT-31 | Share supported/unsupported; user cancels sharing | User-triggered share or download fallback; cancellation is not upload failure. | NOT RUN |
| AT-32 | Organizer deletes media during queued/running render | Job cannot resurrect assets; cleanup verified; results/count preserved. | NOT RUN |
| AT-33 | Expiry boundary and failing deletion retry | Honest expiry UI, server restriction, actual object cleanup when configured. | NOT RUN |
| AT-34 | Unset retention policy in development | No invented dates, timed deletion, or unlimited-retention promises. | NOT RUN |
| AT-35 | Edit public template / customize personal copy | Original and game snapshots protected; no unintended publication. | NOT RUN |
| AT-36 | TV review, long names, many teams, keyboard/reduced motion | Readable comparison, navigable controls, no clipping or forced animation. | NOT RUN |

## Before requesting shared migration approval

Audit actual deployed schema/functions/policies versus sources; record existing IDs/counts and arrange backup. Apply proposed additive changes in the approved test environment first. Record compatibility and ownership tests, forward-repair/rollback plan and exact migration/configuration scope. No such remote change is needed for this session batch.
