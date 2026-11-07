# PRD v2 requirement and gap checklist

Updated November 6, 2026. These labels describe the whole requirement, not just code existence. Verified means the named behavior passed its stated checks; live smoke evidence is recorded separately below, and does not replace the full acceptance scenarios. The newer [deep review](reviews/2026-11-06-deep-review.md) and [improvement backlog](reviews/2026-11-06-improvement-backlog.md) track the current implementation, deployment, and remaining manual gates.

## Current verification snapshot (November 6)

- The most recent fully verified Pages build is `436895f`; GitHub Actions run `42315743973` passed, and the live `build-info.json` matched that commit. It includes the participant home/history fix and explicit chat offline/reconnect feedback.
- The current suite has 79 passing unit/database tests and 78 passing desktop/mobile browser cases. Lint and the production build pass; the JavaScript entry remains below the enforced 150 KiB gzip budget. The 78 browser cases passed in workflow `42315743973` on the deployed source.
- Physical-device, screen-reader, hosted Storage HTTP, multi-session concurrency, and full authorization acceptance are still separate gates. The historical AT-01 through AT-36 table remains NOT RUN for physical-device acceptance; mock-browser and PGlite evidence does not satisfy those rows.

The full controlling document is preserved in `SnapQuest_Revised_PRD_v2.0.md`. This checklist supersedes the older implementation review where requirements conflict; that review remains historical evidence.

| PRD ID | Status | Code and verification evidence or gap |
| --- | --- | --- |
| HUNT-01 | partial | Local discovery/filtering and staged safe public RPC; new authenticated workspace not connected. No remote discovery check. |
| HUNT-02 | partial | Explicit publish and personal copies exist; browser draft cache only, no distinct server template-draft state. Library population differs across old/new builders. |
| HUNT-03 | partial | Local discovery/filtering and staged safe public RPC; new authenticated workspace not connected. No remote discovery check. |
| HUNT-04 | missing | Local completed-game counts exist; no authoritative unique completed-play event. |
| HUNT-05 | verified | Public-template versus private-game distinction covered by local PGlite access tests; public challenge wording is not secret. |
| AUTH-01 | partial | Existing organizer-profile/owner checks; PGlite denial tests pass. Controlled self-onboarding and permanent-account release path incomplete; preview bypass is development-only. |
| AUTH-02 | verified | Existing redemption RPC and local tests preserve identity/game uniqueness, assigned/balanced teams and existing-member resume. Verification is local, not phones or live Auth. |
| AUTH-03 | partial | Permanent identities can resume/join without anonymous replacement; owner-checked Join this team and Play/Manage switching are implemented. Root/last-game recovery and live multi-device verification remain. |
| JOIN-01 | partial | Individual QR/copy/print and team-specific host Join this team action are implemented. Focused QR paging and live multi-device verification remain. |
| JOIN-02 | verified | Existing redemption RPC and local tests preserve identity/game uniqueness, assigned/balanced teams and existing-member resume. Verification is local, not phones or live Auth. |
| JOIN-03 | verified | Existing redemption RPC and local tests preserve identity/game uniqueness, assigned/balanced teams and existing-member resume. Verification is local, not phones or live Auth. |
| TEAM-01 | partial | Teams can choose a unique pre-start name and any teammate can submit/replace one private pre-start selfie; storage authorization and context synchronization are implemented. Physical-device synchronization, cutoff/opt-out wording and montage use remain. |
| SESSION-01 | partial | Auth is restored before participant rejoin; desktop/mobile tests cover invite recovery after reload and browser Back/Forward. Physical-device, multi-device, and cleared-storage behavior remain. |
| SESSION-02 | partial | Permanent rejoin retains the existing identity on errors; PGlite covers invitation rotation, early closeout, and membership preservation. Live Auth/JWT and concurrent-session behavior remain. |
| SESSION-03 | partial | Participant context refreshes on foreground, online, focus, and polling; return-home preserves the anonymous session. Physical-device interruption/token-refresh and complete Realtime recovery remain. |
| UX-01 | partial | New preview navigation, lifecycle guidance and editor implemented; older authenticated organizer still separate. |
| TIME-01 | verified | Local Create Game remains setup with no timer; domain and database snapshot/setup tests pass. Remote UI integration unverified. |
| TIME-02 | partial | Start Now now passes a live controlled hunt; rescheduling, duplicate-start behavior and connected-device timing reconciliation remain unverified. |
| TIME-03 | partial | Reschedule/extend/end local and live SQL tests pass, and timing transitions now write server-side audit records. Connected-device delivery and full timing acceptance scenarios remain. |
| PLAY-01 | partial | Challenge list, camera controls, server-clock timer, top time-progress bar and all-team accepted-photo progress are implemented. Physical-device timing/reconnect verification and displayed submitter names remain. |
| PROGRESS-01 | partial | Scoped all-team accepted-slot aggregate endpoint/UI is implemented and live migrations are deployed; team selfie model and selfie cutoff/opt-out remain D-07. |
| PHOTO-01 | implemented-unverified | OptimizePhoto re-encodes/resizes images; supported physical phone orientation and HEIC behavior not verified. |
| PHOTO-02 | partial | Private unique upload, server acceptance/cutoff, one active slot, expected-version protection, persisted reconciliation after uncertain responses, and privacy-safe operation events exist. Browser fault tests cover Storage denial, lost response after commit, RPC rejection, cleanup, and signed-preview failure. Hosted Storage HTTP and multi-device races remain. |
| PHOTO-03 | partial | Replacement preserves one active slot and checks the expected previous version; failed cleanup enters a capped local retry queue processed on focus/connection return. A two-device replacement race and server-side durable cleanup remain. |
| PHOTO-04 | partial | Browser tests cover photo denial, uncertain success reconciliation, definitive rejection, and a saved selfie whose preview signing fails without deleting the committed selfie. Real Storage HTTP, device image variants, and durable server cleanup remain. |
| SCORE-01 | partial | PGlite compares SQL final scores with the app scorer for vote-driven winner changes and positive ties; organizer and participant snapshots are checked for agreement. A quick-review policy and hosted scoring/concurrency verification remain. |
| REVIEW-01 | conflicting | Current SQL finalization requires every pending entry decided. Must add per-game quick policy and preserve legacy manual behavior. |
| SCORE-02 | partial | Legacy optional team voting retained. Best-photo rule is open D-06, no new rule implemented. |
| REVIEW-02 | partial | Existing all-item grid/placeholders/enlargement and pending approval controls. Selected-item paging, attribution and reject/restore UI missing. |
| FINAL-01 | partial | Owner-only stored final scores exist; completed retries reject, no completion ledger or render-job uniqueness. |
| POST-01 | partial | Existing members can read results after completion; no configured guest window or montage. This batch tests existing-member closeout resume locally. |
| POST-02 | missing | No real montage lifecycle, preview, download or user-triggered share. |
| POST-03 | missing | No real montage lifecycle, preview, download or user-triggered share. |
| POST-04 | partial | Existing private game/media permissions; no video export/share flow or disclosure. |
| POST-05 | missing | No retention/access policy fields, actual dates or explicit unset-policy UI. The [privacy/lifecycle proposal](PRIVACY_LIFECYCLE_POLICY.md) records the current gap; owner-approved durations and an implemented deletion workflow are still required. |
| VIDEO-01 | missing | Required version-one scope. No renderer, real reel, cleared catalog or coordinated deletion/expiry model. Runtime, profile, rights and policy gates remain. |
| VIDEO-02 | partial | SnapQuest frontend branding exists; shared renderer branding configuration missing. |
| VIDEO-03 | missing | Required version-one scope. No renderer, real reel, cleared catalog or coordinated deletion/expiry model. Runtime, profile, rights and policy gates remain. |
| VIDEO-04 | missing | Required version-one scope. No renderer, real reel, cleared catalog or coordinated deletion/expiry model. Runtime, profile, rights and policy gates remain. |
| MUSIC-01 | missing | Required version-one scope. No renderer, real reel, cleared catalog or coordinated deletion/expiry model. Runtime, profile, rights and policy gates remain. |
| MUSIC-02 | missing | Required version-one scope. No renderer, real reel, cleared catalog or coordinated deletion/expiry model. Runtime, profile, rights and policy gates remain. |
| MUSIC-03 | missing | Required version-one scope. No renderer, real reel, cleared catalog or coordinated deletion/expiry model. Runtime, profile, rights and policy gates remain. |
| MEDIA-01 | missing | Required version-one scope. No renderer, real reel, cleared catalog or coordinated deletion/expiry model. Runtime, profile, rights and policy gates remain. |
| MEDIA-02 | missing | Required version-one scope. No renderer, real reel, cleared catalog or coordinated deletion/expiry model. Runtime, profile, rights and policy gates remain. |
| MEDIA-03 | missing | Required version-one scope. No renderer, real reel, cleared catalog or coordinated deletion/expiry model. Runtime, profile, rights and policy gates remain. |
| MEDIA-04 | partial | Stored final score JSON is independent of photo bytes; no completed-play ledger or implemented media-deletion workflow proving preservation. |
| SEC-01 | verified | Local PGlite owner/participant/public-template boundaries pass. No claim of live policy review, rival-progress access tests or full security acceptance. |
| SEC-02 | implemented-unverified | Private bucket/policies and short-lived URLs in code. Storage HTTP/deletion/revocation tests not performed. |
| SEC-03 | partial | SQL validation exists; public abuse controls and expensive-render rate limiting not complete. |
| SEC-04 | verified | Local PGlite owner/participant/public-template boundaries pass. No claim of live policy review, rival-progress access tests or full security acceptance. |
| PRIV-01 | partial | Minimal guest identity design, venue rules, semantic forms and private media exist. [Privacy/lifecycle proposal](PRIVACY_LIFECYCLE_POLICY.md) maps current data/access and deletion gaps; owner decisions on retention, erasure, backups, and user controls remain, along with legal/privacy, physical-device, and assistive-technology review. |
| A11Y-01 | partial | Minimal guest name/identity design, venue rules, semantic forms and private media exist. Legal/privacy, physical device and assistive-technology review outstanding. |
| MIG-01 | verified | Entire v2.0 read; repository/migrations/tests inspected; this batch assessment and local evidence recorded. |
| MIG-02 | partial | Read-only Supabase CLI migration history check on November 6 confirms production migrations `202610280001` through `202611060022` are applied; `202611060023` and `202611060024` are source-only and unapplied. Migration 023 awaits authorization because it prunes expired audit rows; 024 is behind it in the migration chain. |
| MIG-03 | partial | Migrations 001–022 are present in production; 023–024 remain unapplied. Local PGlite coverage does not replace legacy-data mapping, rollback/forward-repair, or staged hosted acceptance. |
| MIG-04 | partial | The migration workflow is additive and locally repeatable. Remote history is verified through 022; production authorization and application of 023–024 remain explicit release gates. |
| MIG-05 | partial | Migrations 001–022 are applied; 023–024 are not. Dedicated hosted authorization, Storage HTTP, and multi-connection tests remain; local PGlite and CI are not used to infer production apply status. |

## Code evidence index

- Hunt/template/navigation: src/lib/workspace.ts, src/lib/huntEditor.ts, src/lib/supabaseWorkspace.ts, src/components/HuntEditor.tsx, src/components/GameManager.tsx, src/pages/admin/LocalDemoWorkspace.tsx; migrations 007–008; workspace, editor, adapter and database tests.
- Accounts/join/continuity: src/App.tsx, src/lib/supabase.ts, src/lib/participantSession.ts, src/pages/participant/JoinGame.tsx, src/pages/participant/ParticipantGame.tsx; migration 003 redemption/context functions; new participant-session tests and permanent-account rejoin database regression.
- Media/review/results: src/lib/photo.ts, src/lib/scoring.ts, src/pages/admin/OrganizerWorkspace.tsx, src/pages/admin/HuntReview.tsx, participant game; migrations 005–006 and 008 acceptance clock update. Current tests do not prove all scoring/voting/deletion edge cases.
- Inventory: source migrations run from `202610280001` through `202611060024`. A read-only linked-project migration listing on November 6 verified production through `202611060022`; `202611060023` audit retention and `202611060024` stable chat pagination are unapplied. The 023 data-prune requires operator authorization before applying; 024 follows it. There is no video worker or licensed music catalog. Selfie uploads and progress aggregates exist; a complete media-deletion/retention service and completion ledger do not.
