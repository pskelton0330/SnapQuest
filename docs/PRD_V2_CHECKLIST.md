# PRD v2 requirement and gap checklist

Updated November 3, 2026 after live Supabase migration deployment and a controlled end-to-end hunt. These labels describe the whole requirement, not just code existence. Verified means the named behavior passed its stated checks; live smoke evidence is recorded separately below, and does not replace the full acceptance scenarios.

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
| TEAM-01 | missing | No team selfie model or scoped all-team aggregate endpoint/UI. Selfie cutoff/opt-out remains D-07. |
| SESSION-01 | partial | This batch restores Auth before join, handles permanent rejoin, retains identity on errors, and fetches context on foreground/online/focus. Phone tests, root/last-game recovery, reconnect UI, full subscription/race recovery remain. |
| SESSION-02 | partial | This batch restores Auth before join, handles permanent rejoin, retains identity on errors, and fetches context on foreground/online/focus. Phone tests, root/last-game recovery, reconnect UI, full subscription/race recovery remain. |
| SESSION-03 | partial | This batch restores Auth before join, handles permanent rejoin, retains identity on errors, and fetches context on foreground/online/focus. Phone tests, root/last-game recovery, reconnect UI, full subscription/race recovery remain. |
| UX-01 | partial | New preview navigation, lifecycle guidance and editor implemented; older authenticated organizer still separate. |
| TIME-01 | verified | Local Create Game remains setup with no timer; domain and database snapshot/setup tests pass. Remote UI integration unverified. |
| TIME-02 | partial | Start Now now passes a live controlled hunt; rescheduling, duplicate-start behavior and connected-device timing reconciliation remain unverified. |
| TIME-03 | partial | Reschedule/extend/end local and live SQL tests pass, and timing transitions now write server-side audit records. Connected-device delivery and full timing acceptance scenarios remain. |
| PLAY-01 | partial | Existing challenge list/timer/camera controls. All-team progress and displayed submitter names incomplete. |
| PROGRESS-01 | partial | Scoped all-team accepted-slot aggregate endpoint/UI is implemented and live migrations are deployed; team selfie model and selfie cutoff/opt-out remain D-07. |
| PHOTO-01 | implemented-unverified | OptimizePhoto re-encodes/resizes images; supported physical phone orientation and HEIC behavior not verified. |
| PHOTO-02 | partial | Private unique upload, server acceptance/cutoff and one active slot exist. Client reconciliation now checks persisted submissions and retries idempotently after uncertain RPC responses; upload stages, expected-version protection and server-side durable cleanup remain. |
| PHOTO-03 | partial | Replacement keeps one active slot; failed old-photo deletion now enters a capped local retry queue processed on focus/connection return. Expected-version protection, server-side durable cleanup and multi-device races remain. |
| PHOTO-04 | partial | Private unique upload, server acceptance/cutoff and one active slot exist. Separate stages, retained retry, expected-version protection, uncertain-response reconciliation and durable cleanup retry remain. |
| SCORE-01 | conflicting | Configurable approved-item points exist. SQL dense ranks versus display competition ranks still disagree; quick policy absent. |
| REVIEW-01 | conflicting | Current SQL finalization requires every pending entry decided. Must add per-game quick policy and preserve legacy manual behavior. |
| SCORE-02 | partial | Legacy optional team voting retained. Best-photo rule is open D-06, no new rule implemented. |
| REVIEW-02 | partial | Existing all-item grid/placeholders/enlargement and pending approval controls. Selected-item paging, attribution and reject/restore UI missing. |
| FINAL-01 | partial | Owner-only stored final scores exist; completed retries reject, no completion ledger or render-job uniqueness. |
| POST-01 | partial | Existing members can read results after completion; no configured guest window or montage. This batch tests existing-member closeout resume locally. |
| POST-02 | missing | No real montage lifecycle, preview, download or user-triggered share. |
| POST-03 | missing | No real montage lifecycle, preview, download or user-triggered share. |
| POST-04 | partial | Existing private game/media permissions; no video export/share flow or disclosure. |
| POST-05 | missing | No retention/access policy fields, actual dates or explicit unset-policy UI. |
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
| PRIV-01 | partial | Minimal guest name/identity design, venue rules, semantic forms and private media exist. Legal/privacy, physical device and assistive-technology review outstanding. |
| A11Y-01 | partial | Minimal guest name/identity design, venue rules, semantic forms and private media exist. Legal/privacy, physical device and assistive-technology review outstanding. |
| MIG-01 | verified | Entire v2.0 read; repository/migrations/tests inspected; this batch assessment and local evidence recorded. |
| MIG-02 | partial | Migrations 001–010 are applied and remotely verified; future migrations still require legacy mapping, repair steps and approval, and release gates remain unresolved. |
| MIG-03 | partial | Existing additive migrations and local tests retained; no schema/live auth change or deployment this batch. Future migrations still require legacy mapping, repair steps and approval; release gates unresolved. |
| MIG-04 | partial | Existing additive migrations and local tests retained; no schema/live auth change or deployment this batch. Future migrations still require legacy mapping, repair steps and approval; release gates unresolved. |
| MIG-05 | partial | Existing additive migrations and local tests retained; no schema/live auth change or deployment this batch. Future migrations still require legacy mapping, repair steps and approval; release gates unresolved. |

## Code evidence index

- Hunt/template/navigation: src/lib/workspace.ts, src/lib/huntEditor.ts, src/lib/supabaseWorkspace.ts, src/components/HuntEditor.tsx, src/components/GameManager.tsx, src/pages/admin/LocalDemoWorkspace.tsx; migrations 007–008; workspace, editor, adapter and database tests.
- Accounts/join/continuity: src/App.tsx, src/lib/supabase.ts, src/lib/participantSession.ts, src/pages/participant/JoinGame.tsx, src/pages/participant/ParticipantGame.tsx; migration 003 redemption/context functions; new participant-session tests and permanent-account rejoin database regression.
- Media/review/results: src/lib/photo.ts, src/lib/scoring.ts, src/pages/admin/OrganizerWorkspace.tsx, src/pages/admin/HuntReview.tsx, participant game; migrations 005–006 and 008 acceptance clock update. Current tests do not prove all scoring/voting/deletion edge cases.
- Inventory: eight migrations 202610280001 through 202610290008; no new migration this batch. No video worker, music catalog, selfie lifecycle, aggregate progress RPC, media-deletion service or completion ledger exists in the inspected application.
