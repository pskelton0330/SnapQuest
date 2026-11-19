# SnapQuest — Deep Review

- **Repo:** https://github.com/pskelton0330/SnapQuest
- **Live app:** https://pskelton0330.github.io/SnapQuest/
- **Reviewed commit:** `f28d474` — "Approve hunt photos by default and celebrate finalized winners" (2026-11-09)
- **Reviewer:** Muse, at Pat's request
- **Review date:** 2026-11-18
- **Status of this file:** Findings only. No code was changed. The coding changes are for Pat's other agent to make, based on this review.

## Method and limits

- Read `README.md`, `package.json`, `src/App.tsx`, `src/main.tsx`, all `src/lib/*.ts`, all `src/pages/**/*.tsx`, all `src/components/**/*.tsx`, migrations 001–030 (close reads of 003, 005, 006, 012, 016, 017, 027, 030), `tests/*.mjs`, `docs/reviews/2026-11-06-deep-review.md`, `IMPLEMENTATION_REVIEW.md`, the remediation status / backlog, and the deploy workflow.
- Play-tested the live site in a desktop browser on 2026-11-18, 08:43–08:46 EST. No sign-in, no real hunt created, no photos uploaded, nothing in production changed.
- Ran `npm test` once in this checkout: 48/49 passed. `tests/template-database.test.mjs` could not load here because `node_modules` is absent in this checkout (`ERR_MODULE_NOT_FOUND: @electric-sql/pglite`) — that is an environment gap in this run, not evidence the suite fails in CI.
- **Not verified in this review:** live Supabase (project `ykfkwczcomkhxaraqpuq`), real Storage HTTP allow/deny, concurrent PostgreSQL races, realtime delivery under flaky networks, physical-device testing, real email-link sign-in, or screen-reader acceptance. Database findings below are from reading the SQL and code, not from running them against production.

## What SnapQuest is

A responsive React 19 + TypeScript + Vite family photo scavenger hunt, backed by Supabase Auth, Postgres, Realtime, and private Storage.

- **Organizer:** email magic-link sign-in, hunt workspace, challenge library, hunt drafts, publish, team names / assignment / start mode / voting, QR invite codes, lobby (teams, participants, selfies, chat), Start Now / End / extend / reschedule, photo review, finalize, winner celebration cards.
- **Participant:** anonymous sign-in, 64-hex invite token (`#/join/<64-hex>`), `redeem_invitation` RPC, waiting lobby with team name + team selfie, active play with per-item photo capture (client-side compress to JPEG, ≤800 KB target, ≤8 MB), private Storage upload then `submit_hunt_photo` RPC, team / all-team progress, chat, review gallery + voting, finalized results + winner card for rank-1 teams.
- **Architecture:** hash routing, Supabase JS client with only the publishable key (`src/lib/supabase.ts`) — no service key in the client. Authoritative rules live in security-definer RPCs (`submit_hunt_photo`, `review_submission`, `finalize_hunt`, `cast_hunt_vote`, `redeem_invitation`, `get_hunt_review_gallery`, etc.), with RLS on all public tables and private Storage (`hunt-photos`, JPEG only, 8 MB). Client scoring in `src/lib/scoring.ts` is a display helper; `finalize_hunt` (migration 016) computes dense-ranked `final_scores` in SQL and returns the stored snapshot on retry.

## What changed since the 2026-11-06 deep review

Per `docs/reviews/2026-11-06-remediation-status.md` (updated 2026-11-07), R01–R22 are all claimed "Fixed" (some "in automated coverage" / "hosted acceptance pending"). Verified in code that the big ones are genuinely fixed: dense ranking now matches SQL (`src/lib/scoring.ts` rank logic is dense, not competition); completed views use stored `final_scores` (`HuntReview.tsx`, `ParticipantGame.tsx`); `review_submission` / `finalize_hunt` lock the hunt row and reject post-completion writes (migration 016); gallery time-gate is null-safe (016); selfie attribution survives a team move (016); referenced-media deletion is denied (016); anonymous security-definer RPCs are restricted to two allowlisted functions (migration 027); chat has paging + 8/min rate limit (migrations 020/024); deploy concurrency is now per-ref with `cancel-in-progress: false` (`.github/workflows/deploy-pages.yml`).

The only post-remediation change visible in this checkout is migration 030 — and it is the source of the top finding below. `README.md` still says migrations run "through 029" and "Production history was last checked on November 7, 2026", and `CHANGELOG.md` ends 2026-11-03, so there is **no evidence in the repo that 030 has been applied to production** — do not assume auto-approve is live.

## Prioritized findings

### P1-1 — Auto-approve (migration 030) silently turns review into opt-out, and makes the finalize guard dead code

- **Severity:** P1 — correctness / product semantics.
- **Evidence:**
  - `supabase/migrations/202611090030_auto_approve_hunt_photos.sql:7-13`: default `approval_status` changed to `'approved'`, and a backfill sets **all** `pending` submissions in non-completed hunts to `approved` with `reviewed_by=null, reviewed_at=null`.
  - Same file, `submit_hunt_photo`: both insert and update paths now hard-set `approval_status='approved'`.
  - `src/pages/admin/HuntReview.tsx:176,285-286`: finalize is blocked only by `pendingCount`, and the SQL guard in migration 016 (`if exists … approval_status='pending' then raise`) can now never fire in normal flow — no RPC creates a `pending` row any more. The "Every submitted photo must be approved or rejected first" copy is vacuous.
  - `HuntReview.tsx:276`: the review summary now reads "Photos are approved by default / Uncheck photos that do not meet the hunt rules" — i.e. an organizer who finalizes without opening review scores **every** submitted photo, including junk, wrong-item, or empty-team photos, with no human check.
- **Fix:** Decide this explicitly with Pat, in writing, before shipping 030 to production. If opt-out review is intended, delete the dead `pending` UI/logic (`HuntReview.tsx` pending filter + Approve/Reject branch, `ParticipantGame.tsx` "awaiting review" text, the `finalize_hunt` pending guard) and replace the finalize copy with "Finalizing scores all currently approved photos." If it is not intended, revert 030 and keep pending-by-default. Either way, do not apply the backfill to hunts already in review without telling their organizers — it silently approves photos they had not yet decided on.

### P1-2 — HEIC/HEIF is allow-listed but may not decode in the browser

- **Severity:** P1 — mobile UX, likely iPhone path.
- **Evidence:** `src/lib/photo.ts:27-28` accepts `image/heic` / `image/heif`, but `decodeImage()` (`photo.ts:9-18`) relies on `<img>` + canvas, which does not decode HEIC in most non-Safari browsers; on failure it throws "This photo format could not be opened. Choose a JPEG, PNG, or WebP image." — contradicting the allow-list. `accept="image/*" capture="environment"` (`ParticipantGame.tsx`) invites iPhone camera photos, which are HEIC by default.
- **Fix:** Either transcode HEIC client-side (e.g. `heic2any` / server-side conversion) or remove HEIC/HEIF from the allow-list and from the file-input accept, and test the exact iPhone → Safari and iPhone → Chrome paths. Do not rely on the Photos picker silently converting.

### P1-3 — Unprovisioned permanent participants are dead-ended in the organizer workspace

- **Severity:** P1 — broken journey, partially re-opens R10 from the 2026-11-06 review.
- **Evidence:**
  - `src/lib/appNavigation.ts:3-5` / `src/App.tsx:103`: **any** non-anonymous session routes to `OrganizerWorkspace`, regardless of organizer provisioning or hunt ownership.
  - `src/pages/admin/OrganizerWorkspace.tsx:97-110` (`loadWorkspace`): if no `organizers` row exists it sets "Your account is signed in but has not been provisioned as an organizer", sets loading false, and **returns early — before loading `participants` memberships**, so `playerGames` stays `[]` and the "Return to {team}" link (`OrganizerWorkspace.tsx:587`, which depends on `playerGames`) never renders.
  - A permanent-account player who has never created an organizer profile therefore cannot reach their team game from the home route except by re-entering a direct `#/play/<id>` link.
- **Fix:** Load memberships / `playerGames` before the organizer-profile early return, and when there is no organizer profile but there is a membership, render the participant resume path (or route to `#/play/<id>`) instead of a dead-end error. Test: permanent participant, no organizer row, refresh on `/`.

### P2-1 — Client-clock state synthesis still drives UI gating

- **Severity:** P2 — correctness risk; server is authoritative so data is safe, but the UI can lie.
- **Evidence:**
  - `OrganizerWorkspace.tsx:141-145` (`loadWorkspace`): synthesizes `status: 'ended'` from `Date.now()` vs `start_at + duration_minutes` — device clock, not server clock.
  - `ParticipantGame.tsx:runtimeState` (`useMemo`): recomputes runtime from `context.status` / `start_at` / `ends_at` / locally ticking `serverNow`, **ignoring `context.runtime_state`** returned by `get_participant_context` (migration 013/016), which is the server-authoritative value. The upload button is disabled on `remainingSeconds <= 0` from that same local clock.
  - A wrong device clock can therefore show "Ready for review" / hide Start, or block/allow photo upload UI up to the 15 s poll + drift window.
- **Fix:** Use `context.runtime_state` (and `get_game_lobby`'s `runtime_state` in the organizer) as the single source of truth for state; use the local clock only for the countdown display. Keep the server RPC as the deadline enforcer (it already is).

### P2-2 — `normalizeFinalScores` / `normalizeScoringVotes` silently drop malformed rows

- **Severity:** P2.
- **Evidence:** `src/lib/scoring.ts:14-44`: both functions `flatMap` + return `[]` for any row failing the type check. In `HuntReview.tsx`, `completedResults` only shows "Final scores are unavailable" when `scores.length === 0`; a single malformed team row would silently vanish from the leaderboard while the rest display as if complete.
- **Fix:** Validate the whole payload and surface an error ("Final scores could not be read") if any row is malformed, instead of filtering silently. Add a test with one bad row.

### P2-3 — Completed results disappear entirely if the participant gallery load fails

- **Severity:** P2.
- **Evidence:** `ParticipantGame.tsx:243-245`: `participantScores` is computed only when `runtimeState === 'completed' && reviewGallery` is non-null. The scoreboard, the winner card, and the "finished #rank" note are all inside the `reviewGallery && …` section (`ParticipantGame.tsx:590-593`). If `loadReviewGallery` errors (a gallery RPC error sets the global `error` and leaves `reviewGallery` null), a completed player sees no results at all, with only a generic error + "Retry gallery" button.
- **Fix:** Load `final_scores` independently of the photo gallery (or fall back to a scores-only RPC), and render the scoreboard even when photo previews fail.

### P2-4 — No hunt deletion / retention exit; audit events grow without bound

- **Severity:** P2 — privacy / operations.
- **Evidence:** `docs/HUNT_DELETION_DESIGN.md` states deletion is "not implemented"; there is no delete/archive control in `OrganizerWorkspace.tsx` (only library-item archiving). Migration 025 is a no-op and 029 "disables any earlier pruning behavior"; `README.md` says "Diagnostic events must be retained beyond 365 days; no maximum is set." Photos, selfies, chat, and audit rows therefore have no owner-operable removal path.
- **Fix:** Owner decision first (per the design doc's open questions), then implement the server-authorized deletion job it describes — or at minimum document the retention position to participants. Do not rely on browser-local cleanup queues (`src/lib/photoCleanup.ts`) as the deletion story.

### P2-5 — `createSupabaseWorkspaceRepository` is dead production code; three workspace implementations drift

- **Severity:** P2 — maintainability / correctness drift.
- **Evidence:** `src/lib/supabaseWorkspace.ts:21` defines the Supabase adapter, but no production component imports it (only `tests/supabase-workspace.test.mjs:3,34`). Production uses direct RPC calls in `OrganizerWorkspace.tsx`; the dev preview uses the local-storage repo in `src/lib/workspace.ts` + `GameManager` / `HuntEditor` / `HuntDiscovery`. The adapter's `mapGameRow` / `hydrate` / `configureGame` can therefore drift from the real organizer flow without any test failing — e.g. its `commandGame` maps `end` / `rotate` to `{p_hunt_id:id}` while other paths use `p_game_id`, and its `load()` calls `get_game_lobby` per hunt in `Promise.all` with no error isolation.
- **Fix:** Either wire the adapter into the production workspace (and delete the duplicated direct calls) or delete it and its tests, and note the dev preview as explicitly non-production. Do not keep three parallel implementations.

### P2-6 — `reportOperation` can spam the audit log; failure deduplication is per-stage only

- **Severity:** P2 — operations / cost.
- **Evidence:** `src/lib/operationLog.ts:9-22`: failures are deduped per `huntId:stage` for 60 s, but **successes are never throttled** — every accepted photo/selfie/finalize writes a `record_audit_event` row via RPC. With 15 s polling + realtime + retries, a busy hunt writes a large, low-value audit trail, and the 60 s failure window can also hide a burst of distinct failures under one stage.
- **Fix:** Report successes only for organizer-visible milestones (or sample), and key the failure dedupe by `operationId` / `stage` + error class, not just stage. Confirm audit-table growth in the test project.

### P3-1 — Dead `pending` UI branches (consequence of P1-1, listed separately so they are not missed)

- **Evidence:** `HuntReview.tsx:281` renders Approve/Reject buttons only when `photo.status === "pending"` — unreachable via current RPCs; the checkbox toggle is the only live path. `ParticipantGame.tsx` "awaiting review" text and the `reviewFilter` "Needs review" option are likewise unreachable. `src/lib/scoring.ts:3` still types `approvalStatus: 'pending' | …'`.
- **Fix:** Remove or re-enable consistently with the P1-1 decision; do not leave a review UI that implies a pending state exists.

### P3-2 — `submitPhoto` fabricates a submission id and hard-codes approval on the optimistic path

- **Severity:** P3.
- **Evidence:** `ParticipantGame.tsx:submitPhoto` (setSubmissions after accept): `id: reconciledRow?.id ?? current[item.id]?.id ?? crypto.randomUUID()` — a random UUID that does not exist in the DB — and `approval_status: reconciledRow?.approval_status ?? 'approved'`. The id is not currently used for a later RPC, but any future code trusting `submissions[item].id` (e.g. a review/decide call) would act on a phantom row.
- **Fix:** Use only the id/status returned by the RPC / reconciliation query; if neither is available, keep the previous row or refetch instead of inventing an id.

### P3-3 — Native `window.confirm` for destructive organizer actions; `ConfirmDialog` exists but is dev-only

- **Severity:** P3 — UX / accessibility.
- **Evidence:** `OrganizerWorkspace.tsx:444` (regenerate invites), `:467` (End hunt), `:485` (Start now) use `window.confirm`. `src/components/ConfirmDialog.tsx` exists but is only used by dev-only `GameManager.tsx:101`.
- **Fix:** Reuse `ConfirmDialog` in the production workspace for all three, with the same wording about revoking links / ending submissions.

### P3-4 — `HuntReview.retryReviewPhoto` re-signs every photo to retry one

- **Severity:** P3 — performance.
- **Evidence:** `HuntReview.tsx:retryReviewPhoto` deletes one cache entry then calls `load()`, which re-signs **all** submissions + selfies (`load()` → `signedUrl` per row). Same pattern in `ParticipantGame.tsx:retryReviewPreview` is per-photo (good) — the organizer path is the outlier.
- **Fix:** Re-sign only the requested path, mirroring the participant implementation.

### P3-5 — Celebration card silently drops the selfie on any fetch failure, with no warning

- **Severity:** P3.
- **Evidence:** `src/lib/celebrationCard.ts:loadImage` fetches the signed URL; on failure `renderWinnerCelebrationCard` catches and fills the photo area with team colour (`celebrationCard.ts:112-120`). A 300 s signed URL that expired while the organizer/participant was reading results therefore produces a colour-block card with no indication a photo was expected. Emoji `🏆` is also drawn via canvas `fillText` (`:120`), which renders inconsistently across platforms.
- **Fix:** Surface "team photo unavailable — retry" before rendering, or refresh the signed URL at card-build time; test the card on iOS Safari with an expired URL.

### P3-6 — Vote changes are silent and un-audited

- **Severity:** P3 — suspicion, not a confirmed bug.
- **Evidence:** `cast_hunt_vote` (migration 006:64-73) upserts on `(hunt_item_id, voting_team_id)`, so a team can change its vote any time during review, with no UI copy explaining that, and no audit event for vote changes. Provisional scores in `HuntReview.tsx` recompute live, so an organizer can watch votes move before finalizing.
- **Fix:** Confirm the intended rule (changeable vs one-shot) with Pat; if changeable, label the button "Change vote" and log vote changes in the audit trail.

### P3-7 — `winningTeams` assumes sorted input

- **Severity:** P3 — fragile API.
- **Evidence:** `src/lib/scoring.ts:8-12`: `winningTeams` filters `rank === scores[0].rank` without checking `scores[0]` is rank 1 or that the array is sorted. Both current callers pass sorted data, so this is not a live bug, but a future caller passing DB order could crown the wrong team.
- **Fix:** Compute `minRank = Math.min(...scores.map(s => s.rank))` and filter on that, or sort inside the function.

### P3-8 — `JoinGame` swallows the invite-preview error

- **Severity:** P3.
- **Evidence:** `src/pages/participant/JoinGame.tsx:18-24`: `preview_invitation` is called with `.then(({data}) => …)` and no `.catch` / error branch — a network or RLS failure leaves the heading as the generic "Join the photo hunt" with no error, and the form still renders.
- **Fix:** Show a retryable error state when the preview RPC fails, as the resume path already does.

### P3-9 — Documentation drift (README / CHANGELOG / PRD)

- **Severity:** P3.
- **Evidence:** `README.md` says migrations run through 029 and production was last checked 2026-11-07, but 030 (2026-11-09) exists in the repo with no production-application evidence. `CHANGELOG.md` ends 2026-11-03. `IMPLEMENTATION_REVIEW.md` is a 2026-11-01 snapshot that itself warns not to use it as a status ledger — good, but it is still the file a new reader is likely to open first.
- **Fix:** Single current status page (as the 2026-11-06 review already recommended): requirement → commit → migration → production-applied? → test evidence. Update README's migration/production lines when 030 is applied or explicitly deferred.

## Live-site playtest findings (2026-11-18, desktop browser)

- **Dev demo does not open on the deployed site.** The development-only demo workspace at `https://pskelton0330.github.io/SnapQuest/#/dev/browse` does **not** open on the deployed site. Tried six ways — direct load, reload, waiting 5 seconds, hash navigation from the home page, a `?dev=1` flag, and the shorter `#/dev` — every attempt silently showed the home page with no error, redirect notice, or message. Verified in source (`src/App.tsx`): the dev routes render only when `import.meta.env.DEV` is true, and the home page's Organizer button only links to `/dev/browse` in dev mode — Vite sets that flag false in production builds, so the workspace is compiled out of the GitHub Pages deployment. The README confirms the workspace lives at `http://localhost:5173/#/dev/browse`, i.e. only on a local dev server. The silent fall-through to the home page is itself a rough edge — a visitor following a stale `/dev` link gets no indication anything is wrong.
- **Home page works well.** Loads quickly, clean single-screen design with a photo-collage background — "SNAPQUEST — Photo Scavenger Hunt", "EXPLORE • CAPTURE • COMPETE / MAKE MEMORIES", "Join with your team link, or create a hunt for friends." Two clear entry points: "I'm a Player — Join a game and start the adventure" and "Organizer Login — Create and manage games". No console errors, broken images, or layout problems at desktop width in the flows used; mobile was not tested.
- **Player Check-In:** empty submit gives native "Please fill out this field"; a short code (FAKECODE123) gives a clear inline error, "Enter the 64-character team code or paste your full invitation link." A well-formed 64-character fake code navigated to `#/join/<code>` and, after "Loading your hunt…", showed a "Private game invitation / Join the photo hunt" screen asking "What should your team call you?" — no name was submitted, so no join was attempted.
- **Join is blind (L1).** The join screen shows no hunt name, team name, date, or organizer — a player is asked to give their name and join blind, and the invite code is not visibly validated before that step (a fake 64-character code reached the name form). Consider showing the hunt title/team and an "invalid invitation" state for bad codes.
- **Organizer Login:** password-free magic link ("Send me a sign-in link", "Secure, password-free sign in"); a malformed email produced the native "Please include an '@' in the email address" error, and the button was enabled with no "Supabase not configured" warning, so Supabase appears configured in production. No sign-in was attempted, no real email entered.
- **Home page has no footer, About, How it works, FAQ, or privacy information** and nothing below the fold; a first-time visitor gets no explanation of how a hunt works, what the 64-character code is, or what happens to photos.
- **Minor quirks:** form state persists across in-app navigation (the typed invite code was still filled after going home and back), and the SnapQuest logo link returns to the last form view rather than the welcome screen. The only network action beyond page loads was the read-only lookup for a fake invite code.

## Security / privacy — checked, no new critical exploit found

- **Keys:** only `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` in the client (`src/lib/supabase.ts`); the production URL is also hardcoded in `.github/workflows/deploy-pages.yml:21` (public by design — it is the publishable endpoint, not a secret). No service-role key in the repo (grep found only Vault-held invite-recovery key references in migrations 018/022).
- **Anon surface:** migration 027 revokes anon EXECUTE on all security-definer RPCs except `list_hunt_templates(boolean)` and `preview_invitation(text)`, and removes anon from default function ACLs. `preview_invitation` is anon-callable by design (it returns title/venue/team/start for a 64-hex bearer token — guessing is infeasible, but the token **is** the only secret; treat invite links as bearer credentials).
- **Storage:** bucket `hunt-photos` is private, JPEG-only, 8 MB (`005:14-15`); upload/view/delete policies are path-shape + membership + time-gated (`can_submit_hunt_photo` requires `scheduled`/`active` + within `start_at … start_at+duration`). Migration 026 correctly excludes `…/selfie/…` paths from the general post-hunt photo policy (`can_view_hunt_photo` returns false for segment 3 = `selfie`) — the R21 leak is fixed **in SQL**, but only if 026 is actually applied in production.
- **Photo privacy:** `optimizePhoto` re-encodes via canvas, which strips EXIF (`src/lib/photo.ts:22` comment) — good. Note: canvas re-encode also strips GPS, but the **original file name** is preserved as `${baseName}.jpg` and the storage path embeds hunt/team/item UUIDs — those UUIDs are not secret, but they are enumerable only with a valid session + membership.
- **Chat:** 8 messages/minute per sender (migration 020:35), 500-char client limit (`HuntChat.tsx`), messages are member-only by RLS; no content moderation / profanity filter — acceptable for a family game, but note it.
- **Audit:** `record_audit_event` is owner-scoped (migration 010/023); client reports are explicitly labelled `client_report: true` and contain no media paths / tokens / message bodies (`src/lib/operationLog.ts:6`, `HuntDiagnostics.tsx`).

## Test coverage gaps (what the suite does not prove)

- `npm test` here: 48/49 unit tests passed; the PGlite suite (`tests/template-database.test.mjs`, ~35 tests including the new auto-approve test at :656, scoring/voting/finalization, RLS, invite recovery) **did not run in this checkout** (missing `node_modules` / `@electric-sql/pglite`). In CI it is the main DB safety net — do not treat the 48 passing tests as full coverage.
- No unit tests for: `optimizePhoto` (HEIC, EXIF, oversize), `renderWinnerCelebrationCard` (only caption/filename are tested), `ParticipantGame.submitPhoto` reconciliation / retry paths, `HuntReview.finalize` / `decide`, `JoinGame` resume/probe, `App.tsx` routing (only the `shouldRouteToOrganizerWorkspace` helper is tested), `supabaseWorkspace.load()` hydration, `HuntChat` pagination edge cases (only `countNewMessages` is tested), or the 300 s signed-URL renewal paths.
- Playwright (`tests/browser/home.spec.ts`, 2,108 lines) covers desktop/mobile home flows, but — per the remediation status itself — real Storage HTTP allow/deny, concurrent Postgres races, physical-device, real email-link, and screen-reader acceptance remain **unobserved**. The remediation status is honest about this; do not read "82/82 + 122/122 passed" as a release sign-off for those areas.

## Suggested order

1. **P1-1 decision + 030 production status** — decide opt-out vs revert, and record whether 030 is applied in production. This changes scoring semantics for every open hunt.
2. **P1-3** (unprovisioned permanent participant dead-end) and **P1-2** (HEIC) — both are broken journeys on real phones.
3. **P2-1** (server runtime as source of truth), **P2-2** (fail loudly on malformed final scores), **P2-3** (scores independent of gallery).
4. **P2-4 / P2-5 / P2-6** — deletion/retention policy, kill or wire the dead Supabase adapter, audit-volume guardrails.
5. P3 items as polish, with P3-1 tied to the P1-1 decision.

## Untested / not verified in this review

- Whether migration 030 (or 026–029) is actually applied to production project `ykfkwczcomkhxaraqpuq` — repo only, no dashboard access.
- Real Storage HTTP allow/deny for cross-team selfies/photos, concurrent photo replacement / review-vs-finalize races, realtime delivery under flaky networks, iOS native share, and 200% zoom / screen-reader behaviour.
- The dev-only preview (`#/dev/*`) was inspected for drift only; it is not the production app and its local-storage games do not touch Supabase.
