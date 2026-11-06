# SnapQuest deep review and implementation handoff

Date: November 6, 2026. Reviewed application commit: `9821300ca779bcd18f64fc9d1f94622674f484de`.

## Assessment

SnapQuest has a workable foundation, but several recent fixes solve only part of the reported behavior. Prioritize reliability of home navigation, photo persistence, review, and scoring before expanding features. A successful deployment or passing build proves code delivery; it does not prove these user flows work.

This review found **20 actionable findings: nine P1 issues and eleven P2 issues**. P1 means a broken core journey, data-integrity problem, or authorization-boundary defect to fix before wider testing. P2 means an important usability, reliability, or operational improvement. The report does not assign a P0 critical exploit.

The most consequential findings are:

- A guest's Return home button still returns to the same recovery screen.
- A naturally expired hunt cannot progress through review using the main review screen.
- Organizer results and winner cards can disagree with the database's final scores.
- The backend permits photo decisions to change after finalization.
- A successfully saved selfie can be deleted by its own error handler when preview signing fails.

## Scope, method, and limits

Inspected the production routing in `src/App.tsx`, authenticated organizer and participant screens, photo and selfie upload/replacement paths, invitation handling, chat, celebration cards, migrations 001–015, existing tests, deployment workflow, roadmap, plan, and requirement checklist. The separate development preview was inspected for integration gaps; it is not the production organizer application.

Executed on the reviewed checkout:

| Check | Result |
| --- | --- |
| `npm test` | 55/55 pass |
| `npm run lint` | Pass |
| `npm run build` | Pass; Vite warns about a roughly 578 KB minified JavaScript bundle, roughly 163 KB gzip |
| Local review probes | Seven observed outputs reproduced; see the companion script |

The probes use the actual migration SQL in an isolated PGlite database with minimal Auth/Storage stand-ins. They make no network calls or production changes. They demonstrate SQL function behavior and data-contract defects; they do not simulate Supabase Storage HTTP, realtime delivery, or two concurrent database sessions.

No authenticated browser automation, fresh phone walkthrough, screenshot-based layout review, accessibility tooling, production load test, or hosted security exploitation was performed. UI findings below are based on executable branches, component integration, and CSS inspection. Network-failure cases are source-confirmed failure paths with proposed injection tests. Do not label those cases physically reproduced on Safari.

The audit changed only this report and its local evidence script. Application fixes and database changes remain for the implementation phase. Earlier chat claims that all flows were working should be read with these limits in mind.

Reproduce the database/helper evidence from the repository root:

```sh
node --experimental-strip-types docs/reviews/2026-11-06-probes.mjs
```

[Companion evidence script](2026-11-06-probes.mjs)

## Prioritized finding index

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| R01 | P1 | Guest home recovery loops back to the same screen | Source-confirmed |
| R02 | P1 | Natural timer expiry strands organizer review | SQL reproduction + UI branches |
| R03 | P1 | Organizer scores/winner differ from authoritative results | Helper reproduction + RPC contract |
| R04 | P1 | Completed photo decisions remain mutable | SQL reproduction |
| R05 | P1 | Selfie preview failure deletes a committed selfie | Source-confirmed error path |
| R06 | P1 | Failed replacement can report an old photo as success | Source-confirmed reconciliation path |
| R07 | P1 | Moving the selfie submitter violates a foreign key | SQL reproduction |
| R08 | P1 | Manual lobby exposes challenge list through review RPC | SQL reproduction |
| R09 | P1 | Storage deletion permits removal of referenced final photos | Authorization helper reproduction + policy |
| R10 | P2 | Host play/manage switch is not membership-aware | Source-confirmed |
| R11 | P2 | QR persistence remains browser-local and can show stale links | Source-confirmed |
| R12 | P2 | Lobby freshness, presence, and selfie error states are incomplete | Source-confirmed |
| R13 | P2 | Review/voting screens and signed URLs become stale | Source-confirmed effect dependencies |
| R14 | P2 | Celebration handling excludes players and mishandles ties | Source-confirmed |
| R15 | P2 | Chat has reconnect, scroll, lifecycle, and abuse gaps | Source-confirmed |
| R16 | P2 | Production draft editing and preview capabilities diverge | Source-confirmed route integration |
| R17 | P2 | Reconciliation races and excessive repeated reads | Source-confirmed; load impact unmeasured |
| R18 | P2 | Logging cannot explain most photo/chat failures | Source-confirmed instrumentation gap |
| R19 | P2 | Screen hierarchy and feedback complicate mobile use | CSS/component review; visual validation needed |
| R20 | P2 | Deployment concurrency can cancel production for a PR | Source-confirmed workflow configuration |

## Findings and acceptance criteria

### R01 — Return home remains a guest recovery loop

**Evidence:** [App.tsx](../../src/App.tsx), anonymous-session early return near line 62. The link now reloads `window.location.pathname`, but the anonymous session persists in local storage. After auth restoration, the same anonymous-session branch renders Open your hunt invite again. A different link target cannot fix the branch that intercepts home rendering. Anonymous users also cannot reach the home page's player invite form from this screen.

**Fix:** Render a real home route for guest sessions. Show the player invite form and, when known, Resume current hunt. Preserve the guest identity rather than signing out as a workaround. Distinguish the public home page from the organizer dashboard.

**Acceptance:** With a guest already joined, visit the root and an old hunt address, then choose Return home. The public home and player join form must be reachable; returning to the invite must retain the same participant ID. Test after refresh and with browser back/forward.

### R02 — Natural expiry does not enter the review state the UI requires

**Evidence:** [OrganizerWorkspace.tsx](../../src/pages/admin/OrganizerWorkspace.tsx), `loadWorkspace`, and [HuntReview.tsx](../../src/pages/admin/HuntReview.tsx), `ended`, `startReview`, and approval controls. The organizer list synthesizes `ended` locally using the device clock, while SQL still stores `scheduled` or `active`. In HuntReview, `ended=true` hides the button that calls `begin_hunt_review`, but Approve/Reject buttons require `data.status === 'review'`. The probe observes `status=active` and a pending submission after modeled timer expiry. Finalize also requires SQL review status. Manually using End hunt elsewhere can work around this; natural expiry should not require that detour.

**Fix:** Explicitly offer Start photo review after expiry and call `begin_hunt_review`, or implement a server-authoritative transition. Separate server status from clock-derived runtime status. Do not display the begin-review RPC as an early-end action: it intentionally rejects hunts whose time has not expired; use the early-end RPC for that action.

**Acceptance:** Let a hunt expire without End hunt. Open Review photos, approve/reject, finalize, and read results as a participant. Repeat with no submissions and with the device clock wrong. Ensure no new upload is accepted after the server deadline.

### R03 — Organizer scoring ignores vote payloads, uses different ranks, and recomputes final scores

**Evidence:** [HuntReview.tsx](../../src/pages/admin/HuntReview.tsx), line 75; [scoring.ts](../../src/lib/scoring.ts); [migration 006](../../supabase/migrations/202610280006_voting_and_results.sql), gallery JSON and `finalize_hunt`. Gallery votes contain `item_id`, `voting_team_id`, and `selected_team_id`; the score helper expects camelCase. Casting with `as ScoringVote[]` does not convert runtime keys. The probe passes a valid gallery-shaped vote and gets zero bonus. SQL uses dense ranks (1,1,2), while the helper and its existing test use competition ranks (1,1,3). The organizer recomputes completed scores and picks `scores[0]` for the winner card; participants instead display stored `final_scores`. This can award the displayed trophy to a different team.

**Fix:** Use stored authoritative `final_scores` for all completed displays and celebration inputs. Normalize gallery data once for provisional scoring. Implement the agreed dense ranking contract in the helper and update the existing contradictory test. Share typed RPC contracts or validate payloads at the boundary.

**Acceptance:** Create a game where voting changes the winning team and another with a tie above third place. Organizer, participants, and card must display identical totals, ranks, and winning teams after reload. A finalized score must not depend on recalculating current submission rows.

### R04 — Backend still accepts review mutations after finalization

**Evidence:** [migration 005](../../supabase/migrations/202610280005_private_photo_submissions.sql), `review_submission`, lines 196–219. Its check explicitly permits `completed`. The probe finalizes an approved five-point photo, then rejects that photo through the authenticated owner RPC. The submission changes while `final_scores` still awards five points. The UI hiding review buttons does not prevent a direct RPC call. `review_submission` also lacks the hunt-row lock used by finalization, creating a concurrency concern that needs a real PostgreSQL race test.

**Fix:** Require the review state and lock the hunt row before checking and mutating a decision, using a consistent lock order with finalization. If reopening results is desired later, implement a deliberate, versioned workflow. Make repeated finalization return the existing result or another clearly idempotent outcome.

**Acceptance:** Every approve/reject call after completion must fail without changing rows. Concurrent review/finalize calls must yield a consistent snapshot. Retrying a successful finalize after losing the response must leave one authoritative result.

### R05 — Selfie preview errors can delete the new saved selfie

**Evidence:** [ParticipantGame.tsx](../../src/pages/participant/ParticipantGame.tsx), `submitTeamSelfie`, roughly lines 185–208. After `submit_team_selfie` succeeds, the client removes the old object and requests a signed preview URL. A signing error throws into the common catch, which removes `storagePath`, including the now-committed new object. The database then references a deleted image. A lost RPC response can enter the same destructive cleanup path despite a server commit.

**Fix:** Track uploaded, committed, and uncertain states separately. Once committed, preserve the object and show Saved; preview unavailable with retry. Reconcile uncertain responses against `team_selfies` before any deletion. Delete only proven unreferenced objects, with server-side protection as in R09.

**Acceptance:** Inject a signing failure after commit and a lost response after a successful selfie RPC. In both cases the saved object must remain, and preview retry/reload must recover it. Test replacing a prior selfie too.

### R06 — Photo replacement treats any existing submission as proof the new upload succeeded

**Evidence:** [ParticipantGame.tsx](../../src/pages/participant/ParticipantGame.tsx), `submitPhoto`, roughly lines 234–263. If the submit RPC fails, reconciliation accepts any row for the team/item. When replacing an old photo, that row often is the old submission. The client marks the action accepted, deletes the new uploaded file, and renders the old one without explaining that replacement failed. Concurrent teammates can also overwrite each other's choices because SQL has no expected-version check.

**Fix:** Reconcile the exact attempted storage path or a request ID. An unrelated current row means replacement was not confirmed; show that distinction. Add idempotency and expected-version protection to the acceptance RPC before relying on automatic retries.

**Acceptance:** With an existing photo, force submit failure at the deadline or via network error. The UI must report replacement failure and keep the prior photo clearly identified. Two devices replacing the same slot must not silently overwrite a newer version or delete the accepted object.

### R07 — Team moves fail after that member submits a selfie

**Evidence:** [migration 012](../../supabase/migrations/202611030012_team_identity.sql), composite FK `(submitted_by,hunt_id,team_id)`; [migration 013](../../supabase/migrations/202611040013_manual_start_mode.sql), `move_participant`. The FK requires the selfie submitter to remain in that team. The move RPC changes the participant's team without handling the selfie attribution. The probe reproduces PostgreSQL error `23503` on `team_selfies_submitted_by_hunt_id_team_id_fkey`.

**Fix:** Preserve team ownership of the image while allowing historical submitter attribution independent of current team membership. Prefer an additive schema repair with explicit attribution rules; do not delete a team's selfie just to move a person.

**Acceptance:** Submit a selfie, move its submitter to another team while waiting, and confirm both teams' rosters and the original team's selfie remain correct. Repeat with a different teammate's selfie and verify cross-hunt moves remain denied.

### R08 — Manual-start lobby bypasses review-gallery time gate

**Evidence:** [migration 006](../../supabase/migrations/202610280006_voting_and_results.sql), `get_hunt_review_gallery`, lines 36–38. The gate compares now with `start_at + duration`. With null `start_at`, that expression is null, so the PL/pgSQL IF does not raise. A joined participant can call the security-definer RPC before the start and receive challenge wording and gallery metadata. The local probe reveals one hidden item with status scheduled in a manual lobby. This is a challenge-visibility defect; the probe does not demonstrate cross-hunt access or access to another team's photo bytes before start.

**Fix:** Use explicit allowed states and a null-safe ended condition, then apply an intentional organizer/participant policy. Review other time gates whenever optional scheduling is introduced; the previously fixed selfie policy was another symptom of this change.

**Acceptance:** A manual-lobby participant calling the gallery RPC gets a deliberate closed-gallery response. Scheduled pre-start, active, expired, review, and completed cases each obey the specified access contract. Challenge items remain hidden until start through every endpoint.

### R09 — Storage deletion does not protect objects referenced by submissions or selfies

**Evidence:** [migration 005](../../supabase/migrations/202610280005_private_photo_submissions.sql), `can_delete_hunt_photo` and storage DELETE policy; [migration 012](../../supabase/migrations/202611030012_team_identity.sql), selfie delete helper. Membership alone allows deletion, with no referenced-object or completed-state check. The probe returns `allowed=true` for a participant's referenced finalized photo. Removing its bytes would not update the submission, its status, or final scores. This is within-team integrity risk, not demonstrated cross-team escalation. It amplifies R05 and cleanup races.

**Fix:** Separate cleanup of unreferenced uploads from deliberate deletion of accepted media. Deny ordinary cleanup for any path still referenced by `submissions` or `team_selfies`. Provide an explicit coordinated deletion workflow if users need to remove accepted media.

**Acceptance:** Referenced active and finalized photo/selfie paths cannot be deleted through cleanup credentials. Replaced unreferenced paths can be cleaned. A deliberate delete updates the media state and handles retained results according to policy. Test actual Storage HTTP as well as helper functions.

### R10 — Organizer/player switching relies on route and account type instead of hunt roles

**Evidence:** [App.tsx](../../src/App.tsx), manage/play routes; [ParticipantGame.tsx](../../src/pages/participant/ParticipantGame.tsx), header; [OrganizerWorkspace.tsx](../../src/pages/admin/OrganizerWorkspace.tsx), `initialHuntId` effect and topbar around lines 130 and 379. Any permanent-account participant sees Organizer menu, even if they do not own that hunt. Return to team game appears only when `initialHuntId` exists, and points at that initial hunt even after opening another. A host visiting their dashboard directly after joining has no membership-aware resume action. Changing manage hashes while this component stays mounted is ignored once `managedHunt` exists. Backend owner checks remain important and appear to prevent this UI problem becoming an ownership bypass.

**Fix:** Load trusted current-hunt capabilities: organizer ownership plus participant/team membership. Build the Play / Organizer menu switch from those values, display the team name, and keep current hunt selection synchronized with the route. Scope state/reset components when hunt ID changes.

**Acceptance:** Owner-player, owner-not-playing, permanent non-owner player, and guest each see only appropriate actions. Switch between two hunts, refresh, and use browser history. Return to team game must name and open the intended hunt/team without changing participant identity.

### R11 — QR-code persistence is a local cache rather than durable organizer access

**Evidence:** [OrganizerWorkspace.tsx](../../src/pages/admin/OrganizerWorkspace.tsx), lines 35–46, `openManageHunt`, and `regenerateInvites`. Raw invite values are held in localStorage, keyed only by hunt ID, without server validation. New devices and cleared storage cannot retrieve them. Rotating on one browser leaves stale cached codes on another. `saveInvites` can throw after a successful publish/rotation, producing a misleading failure; rotation has no finally block to restore busy state in that case. A browser cache is not encrypted secret storage.

**Fix:** Treat cache as optional and account-scoped, validate invitation identifiers/revocation before showing codes, and handle storage failures separately from server success. Design owner-only durable invitation retrieval or another secure, recoverable invitation mechanism. Preserve old valid links during migration; do not silently rotate just to make codes visible. Confirm deliberate replacement because it revokes distributed links.

**Acceptance:** Reopen on the same browser, another organizer device, after storage clearing, and after rotation elsewhere. Never display revoked codes as current. Simulated localStorage denial must not report a committed publish as failed or leave buttons stuck. Existing participants must still resume after rotation.

### R12 — Lobby member/selfie view is manual and errors look like missing photos

**Evidence:** [OrganizerWorkspace.tsx](../../src/pages/admin/OrganizerWorkspace.tsx), `loadManagedLobby`, roughly lines 221–245; [TeamLobby.tsx](../../src/components/TeamLobby.tsx). Loads run on open/publish/explicit Refresh, with no lobby realtime or polling. Moving a member updates only the flat roster, leaving grouped team cards stale. Signing errors are discarded; a saved selfie whose preview cannot load is labeled No team selfie yet. The list represents joined membership, not currently logged-in/online presence. The participant waiting view shows its own teammates and identity editor, not this all-team lobby.

**Fix:** Subscribe/reconcile relevant team, participant, and selfie changes with a reconnect fallback. Keep submitted metadata separate from image-load success. Show loading, saved, preview unavailable, and absent states explicitly. Keep Joined wording unless implementing actual presence, then distinguish Online from Joined. Decide whether participants should see all teams/selfies before broadening current privacy policies.

**Acceptance:** Another phone joins, renames a team, uploads/replaces a selfie, or is moved: the organizer view updates without manual refresh. Force a signed-URL failure and confirm Saved, preview unavailable. Test an empty team and a team whose members have closed their browsers.

### R13 — Voting/review data and five-minute signed URLs become stale

**Evidence:** [ParticipantGame.tsx](../../src/pages/participant/ParticipantGame.tsx), `loadReviewGallery` effect depends only on huntId/runtimeState. Polling context while staying in review does not reload this gallery, and no vote subscription is attached. Photos pending when a participant opens review can stay pending after approval, withholding vote buttons until refresh. [HuntReview.tsx](../../src/pages/admin/HuntReview.tsx) reloads after its own decisions, but not other voters' or organizers' changes. Gallery/selfie URLs are signed for 300 seconds without a general refresh strategy in the organizer/review screens.

**Fix:** Reconcile gallery/votes after relevant events, foreground/online transitions, and finalization. Refresh signed URLs before expiry or on image failure. Track connectivity and expose a retry action. Use server scores after completion, even if a provisional gallery fetch is stale.

**Acceptance:** Keep participants in review while the organizer approves photos and another team votes. Buttons/counts update automatically. Leave the screen open over five minutes, background it, then enlarge/download/share images. Finalized results must converge across devices.

### R14 — Celebration cards exclude participants and arbitrarily select one tied winner

**Evidence:** [HuntReview.tsx](../../src/pages/admin/HuntReview.tsx), `winner = scores[0]` and celebration panel; [ParticipantGame.tsx](../../src/pages/participant/ParticipantGame.tsx), completed view; [celebrationCard.ts](../../src/lib/celebrationCard.ts). Share/download controls exist only for the organizer. When scores tie, the alphabetically sorted first team receives the single winning card. With no photos, every team is tied at zero yet one is celebrated as the sole winner. Canvas text uses fixed font sizes and no measured wrapping; long team/hunt names can overflow. Card preview blob URLs are not revoked on replacement/unmount.

**Fix:** Build cards from authoritative results and an explicit tie/no-score rule. Add authorized participant access if the intended outcome is teams sharing their card. Fit or wrap text using measured bounds, retain a deliberate fallback for missing images, and revoke obsolete blob URLs. Verify native sharing after async rendering on iOS; transient user-activation failure is a test target, not reproduced here.

**Acceptance:** One winner, two tied winners, all-zero scores, a missing selfie, and maximum-length names produce honest readable output. Participants can use the intended share/download journey. Test cancel, unsupported native share, and Safari download fallback.

### R15 — Chat lacks recovery and clear lifecycle behavior

**Evidence:** [HuntChat.tsx](../../src/components/HuntChat.tsx), initial RPC and subscription; [migration 014](../../supabase/migrations/202611060014_hunt_lobby_messages.sql), message limit and send operation. A dropped subscription has no status UI or focus/polling recovery. There is no scroll-to-latest/new-message affordance. Only the latest 100 messages load without pagination. Organizer manage screens mount the composer after review/completion even though sends are denied; participant screens hide chat after active play. Sends lock the same hunt row as timing operations and have no rate limit.

**Fix:** Show reconnect/read-only status, reconcile after reconnect and foreground, paginate history, and keep the latest conversation reachable. Pass a lifecycle/capability contract to the composer. Add bounded server-side rate limiting; consider lock contention before retaining a hunt-row lock for every message.

**Acceptance:** Send while another phone is backgrounded/offline, reconnect, and verify missing messages appear. Test over 100 messages, completed hunts, repeated taps, and basic spam limits. Ensure chat traffic cannot significantly delay Start/End actions under the intended group size.

### R16 — Production cannot edit saved hunt content; the richer workspace is development-only

**Evidence:** [App.tsx](../../src/App.tsx), DEV-only `LocalDemoWorkspace`; [OrganizerWorkspace.tsx](../../src/pages/admin/OrganizerWorkspace.tsx), `createHunt`/`openManageHunt`. After saving a draft, Continue setup only provides start mode, teams, and voting. It does not load an editor for saved title, venue, rules, challenge wording/order/points. Richer editor/discovery/game-management components and related pure tests exist in a separate development path; their presence does not make those features available in production. Timing extension/rescheduling RPCs similarly lack controls in the main authenticated organizer screen.

**Fix:** Reuse the editor and shared domain contracts inside the authenticated production workspace. Add Edit draft, prepublish review, and clear saved state. Preserve snapshots once a game starts. Integrate timing controls separately with existing authorization/cutoffs.

**Acceptance:** Save a draft, leave, reopen, correct a typo/change points, and publish the corrected version. Preview and production must exercise the same core components and contracts. Existing games must retain their own snapshots when reusable templates change.

### R17 — Repeated context refreshes cause request amplification and stale-write races

**Evidence:** [ParticipantGame.tsx](../../src/pages/participant/ParticipantGame.tsx), `loadContext`, effects depending on the entire `context`, and 15-second polling. Each successful context fetch creates a new object, restarts selfie signing, reloads items/submissions, signs all returned photos, and retries cleanup. `setSelfieUrl('')` clears the preview on each cycle. Focus, visibility, online, polling, and realtime can overlap. `loadContext` has no response generation guard, so an older response may overwrite newer state. A successful context read can also clear an unrelated item-fetch error. During review, the item loader queries all authorized teams' submissions and keys them only by item ID.

**Fix:** Split membership, timer, gallery, and media state. Depend on stable IDs/versions, retain usable previews during refresh, coalesce requests, and reject stale responses. Keep errors scoped to operations. Filter own-team gameplay submissions explicitly and use team/item compound keys for any all-team cache. Add a clear reconnect indicator.

**Acceptance:** Delay an older request while a newer one completes after start/end/team move; the view must not regress. Count requests for ten unchanged refresh cycles: unchanged photo URLs should not all be regenerated every cycle. Test typing a team name, backgrounding, returning online, and a slow initial image request. Actual load/cost impact still requires measurement.

### R18 — Durable logging covers timing but not the failures users are reporting

**Evidence:** [migration 010](../../supabase/migrations/202610300010_audit_logging.sql) defines an audit RPC, and migrations 011/013 record timing transitions. The current photo/selfie/chat UI does not call the audit RPC, and key acceptance/review/finalization functions lack corresponding success/failure instrumentation. A failed transaction cannot preserve its own audit insert without an appropriate external logging path. Existing logging therefore cannot establish a full history of failed storage uploads or signed-preview requests.

**Fix:** Add privacy-safe operation IDs and stage/outcome reporting for upload, acceptance, reconciliation, preview, cleanup, review, and finalization. Use the trusted server for authoritative events; label client reports as client reports. Capture rolled-back failures through service logs or a separate reporting transaction. Store no tokens, signed URLs, image content, or message bodies in diagnostic details. Provide a small organizer support view with timestamp, operation ID, and retry advice.

**Acceptance:** Reproduce one RLS denial, lost response, signing failure, and finalization retry in a test project. Trace each by operation ID through the correct stages without exposing private payloads. Establish retention/cleanup for diagnostics explicitly.

### R19 — Mobile hierarchy and feedback require a focused usability pass

**Evidence:** Current organizer manage order is chat, team lobby, start action, QR invitations, flat roster/end control, then Quick team links. The requested quick links are consequently below the roster rather than immediately below QR codes. During play, the full chat panel appears ahead of challenge content. Numerous controls/help text use 8–11 px fonts and 28–39 px control heights in App.css; theme.css overrides some styles, so validate computed sizes rather than assuming every rule wins. Manual waiting copy is replaced using CSS `font-size:0` and pseudo-element content. Back to hunt in HuntReview actually returns to the hunt list. Several async operations expose generic errors without action-specific recovery. Approve/reject controls disappear after a decision, making mistakes difficult to correct before finalization.

**Fix:** Give each lifecycle screen one primary task. Organizer lobby: hunt status and Play/manage switch, start control, team readiness, per-team QR/copy/share, then expandable chat and detailed management. Active player: timer/progress, photo list, compact chat with unread count. Review: selected challenge, large photos, reversible decisions while in review, explicit finalize confirmation. Render waiting copy in JSX; use consistent Back labels. Group duplicate link controls and make targets/readability comfortable on phones.

**Acceptance:** Walk through at 320/375/390 px and 200% text zoom, with keyboard and screen reader. A first-time tester should find Start, Copy team link, Take photo, Organizer menu, Return to team game, and Review without coaching. Verify touch targets, focus order, meaningful status announcements, and no bottom-navigation overlap. These are proposed usability checks, not completed visual sign-off.

### R20 — One concurrency group includes pull-request builds and active publishing

**Evidence:** [.github/workflows/deploy-pages.yml](../../.github/workflows/deploy-pages.yml), workflow-wide `group: github-pages`, `cancel-in-progress: true`, triggered by both pushes and pull requests. A PR run can cancel a main deployment despite never deploying itself. A push can interrupt publishing as well. This control also cannot retroactively cancel older runs created without the concurrency group. Earlier logs in this conversation confirmed a Pages request blocked by an in-progress deployment; that explains those immediate failures, but does not prove why the older Pages operation initially stalled or establish a platform-wide outage.

**Fix:** Give PR validation its own per-PR group; serialize the deployment job separately. Prefer finishing an active publish while superseding queued obsolete builds. Add a build/version manifest plus a smoke check that verifies the served version and usable route behavior. Preserve useful failure history; do not delete failed runs to make the dashboard appear healthy.

**Acceptance:** A PR build cannot interrupt main publishing. Two quick main pushes eventually publish the newest tested commit, with clear logs. Verify the served commit/version and a routed page after deploy; searching a bundle for a string alone is insufficient functional verification.

## Recommended UX contract

Use one current-hunt context with separate ownership and participant membership capabilities. A person can have both. Persist enough safe navigation context to offer Resume hunt, while the database remains the authority for access and team assignment.

| Situation | Primary action | Supporting action/state |
| --- | --- | --- |
| Guest at home | Resume hunt or Join with invite | Guest identity preserved |
| Organizer with no active selection | Open current hunt | Create/manage other hunts |
| Organizer waiting in lobby | Start hunt | Join a team or Play as named team; QR links |
| Organizer playing | Take/upload photo | Organizer menu |
| Organizer managing as a player | Manage current hunt | Return to named team game |
| Participant waiting | Team readiness/selfie | Optional all-team lobby subject to privacy decision |
| Hunt naturally expired | Start photo review for organizer | Players see waiting-for-review state |
| Review | Decide photos and vote | Decisions reversible until finalization |
| Completed | Server-stored leaderboard | Honest tied-winner handling and share/download card |

Keep the main route, current hunt, membership, and button labels aligned. Do not use the absence of an anonymous flag as evidence of organizer ownership.

## Implementation batches for the next model

1. **Navigation and review rescue:** R01, R02, R10. Preserve guest/permanent identities; implement real home and membership-aware switching; prove natural expiry through finalization in the authenticated UI.
2. **Authoritative outcomes and integrity:** R03, R04, R07, R08, R09. Add forward migrations for database fixes. Normalize RPC data, read stored completed results, protect finalization, repair selfie attribution, and lock down reference deletion. Run authorization and state-transition tests before applying migrations.
3. **Reliable media and lobby:** R05, R06, R11, R12, R13, R17. Add operation identity/reconciliation, error states, durable invitation design, synchronization, and signed-URL recovery. Verify actual Storage HTTP and two-device races in a test project.
4. **Usability and operations:** R14, R15, R16, R18, R19, R20. Make cards/decisions/share flows useful to players; integrate the production editor; improve chat and logs; validate deployment behavior and mobile flows.

Each batch should be small enough to review independently. Some issues share a fix, especially R03/R04 and R05/R06/R09. Do not reimplement the whole application, broaden photo access for cosmetic convenience, or silently change identity/retention policies. Video, AI generation, and premium features remain deferred according to PRODUCT_ROADMAP.md.

## Test strategy that closes the current gaps

Existing tests give useful coverage of domain functions, migrations, ownership boundaries, and identity restoration. They omit browser rendering and real Storage HTTP; some fixtures insert storage rows as an administrator, bypassing the upload policy that caused the user's manual-lobby RLS failure. The scoring suite also explicitly expects the conflicting competition-rank behavior. Therefore 55 green tests are not a release sign-off.

Add focused regression tests for the findings, then a small authenticated browser suite around the actual production components. Use a test project/controlled fixture users; do not run destructive probes against real hunts.

Minimum release journeys:

- Guest joins, returns home, resumes after refresh, and retains identity.
- Owner joins a team, switches both ways, opens another hunt, and resumes the correct team.
- Manual and scheduled hunts both accept pre-start selfies and deny gameplay uploads before start.
- Selfie submitter is moved without breaking attribution or deleting the team's image.
- A naturally expiring hunt reaches review and finalization without manual End hunt.
- Voting changes a winner; ties produce identical stored, organizer, participant, and card outcomes.
- Network loss after commit never deletes accepted media or reports an old replacement as new success.
- Finalized decisions reject writes; ordinary cleanup cannot delete current referenced media.
- Review/votes/rosters update on another device; stale signed URLs recover.
- Invite links remain correct across reopen/rotation, with deliberate behavior on another device.
- PR validation cannot cancel production publishing; the served version matches the intended commit.

## Copy/paste prompt for a lower-cost implementation model

> Read `docs/reviews/2026-11-06-deep-review.md` and run its companion local probe script. The report describes commit 9821300; inspect the current checkout before making changes and mark findings already fixed. Start with Batch 1, then tackle the highest-priority confirmed data-integrity findings. For each issue, reproduce it, implement the smallest coherent fix, add a meaningful regression check, and record the result against its R-ID. Use the authenticated production UI, not only the development preview. Preserve guest identities, per-hunt ownership, server-clock cutoffs, and finalized results. Use additive migrations for SQL repairs and verify their state/permission behavior. Run relevant tests, lint, and build. Push completed work to GitHub as requested by the project owner, verify deployments and actual flows, and distinguish tested behavior from code presence. Do not silently mark deferred roadmap items as completed. Keep the report as the original audit and record remediation in a separate file.

## Planning/documentation observations

`PRODUCT_ROADMAP.md` appropriately defers expensive media/AI work, but still says the celebration card is the next feature although it is already present. PRD_V2_PLAN and PRD_V2_CHECKLIST include historical migration counts, partial features, and conflicting older scope statements. Retain dated history, then add one current status page tying requirement IDs, finding IDs, commits, migrations, and actual test evidence together. This will make model handoffs much safer than relying on the conversational statement that everything is live and working.
