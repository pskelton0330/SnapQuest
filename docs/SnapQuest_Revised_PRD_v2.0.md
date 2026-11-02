# SnapQuest
## Revised Product Requirements Document

**Document revision:** 2.0  
**Product target:** Version-one web release  
**Date:** November 2, 2026  
**Product owner:** Pat  
**Development:** Existing React / TypeScript / Vite application with Supabase, developed through Codex

> **Product promise:** Scan into a team, enjoy a simple photo scavenger hunt, compare the photos together, and leave with a branded video memory of the game.

This document revision consolidates the latest product decisions. It is not an instruction to release application version 2.0. Adapt the existing application incrementally; do not rebuild it.

## 1. Authority, scope, and implementation status

### 1.1 Requirements precedence

The confirmed November 2 decisions recorded here supersede conflicting earlier instructions. Unchanged behavior from the October 29 PRD v1.1 and the previously supplied Codex improvement requests remains part of the baseline. The repository and migrations establish what actually exists; this document establishes the intended behavior. A discrepancy must be reported, not silently resolved by discarding working features.

Use these labels throughout implementation:

| Label | Meaning |
| --- | --- |
| Confirmed | A product decision made in the owner's discussion; implement as stated. |
| Carry forward | An existing requirement or previously requested improvement that has not been withdrawn. |
| Engineering specification | A proposed technical safeguard or implementation detail needed to deliver the behavior; equivalent solutions are acceptable when documented. |
| Open decision | Not approved or numerically specified; do not invent a production default. |
| Future | Preserve architectural flexibility only; do not build in this release. |

### 1.2 What is known about the current app

The supplied v1.1 PRD reports organizer magic-link sign-in, venue-first drafts, challenge library, both team-assignment modes, guest registration, server-timed gameplay, photo replacement and attribution, review, voting, and server finalization as implemented. It reports three scoring tests, TypeScript and lint checks, and desktop browser checks, while identifying gaps in real-device, authorization, and end-to-end testing. The production build was not verified in that workstation environment. [B1, sections 5, 7, 9]

The owner subsequently sent a Codex improvement prompt and reports that Codex worked on it. Do not assume its requested features are either absent or complete. Inspect the latest code and report evidence for each feature before changing it. Do not copy v1.1's historical test results into a new release report as current verification.

### 1.3 Delivery boundaries

Version one is web-first. Native iOS/Android distribution follows a satisfactory web interface and dependable game mechanics. No public deployment, paid service, production migration, advertising SDK, subscription billing, or AI inference is authorized by this specification alone.

The montage, participant post-game access, and clear media-deletion controls are version-one requirements, not optional future enhancements. Their engineering and policy decisions must be resolved before claiming the whole version-one scope complete. Work on other modules may proceed independently.

## 2. Decisions that replace earlier instructions

| Topic | Controlling requirement |
| --- | --- |
| Live competition | Every joined team can see progress bars for all teams, based on accepted submissions. Not a host-only view, and not a final score. |
| Default judging | Quick review: all qualifying submissions receive their item points unless the organizer rejects them. One point per challenge by default. No best-photo selection is required. |
| Ties | Equal final totals share a place. Do not force a tiebreaker. |
| Organizer as player | The host can join a team under its QR code and switch between Play and Manage Game without changing identity or membership. |
| Accounts | A permanent account is required to create/publish hunts or organize/start games. Invited players join with a name, without a permanent account. |
| Guest closeout access | Finalization does not immediately revoke guest access. Joined players retain read-only results and montage access during the configured post-game window. |
| Selfie | Prompt each team for a team selfie before play; use it as the team image and in the montage. It is not a scored challenge. |
| Montage | Automatically initiate one branded, music-backed reel for the whole game after the organizer finalizes results. Do not generate at timer expiry. |
| Sharing | Download and deliberate user-initiated sharing are required. Automatic posting to social accounts is not required. |
| Retention | Clear deletion controls are required now. Numerical retention periods and expiry policy remain undecided. Earlier examples such as 7 or 30 days are not approved. |
| Public templates | Preserve explicit publication of original hunts to the public library and personal customized copies. Do not change everything to private-by-default or publish drafts automatically. |
| Mystery and AI | Real-world mysteries, sequential clues, and AI judging are future exploration. Do not add inference costs now. |

## 3. Product model and core journey

### 3.1 Terminology

A **challenge** is one instruction or item to photograph. A **hunt** is a reusable template: challenges, venue context, rules, creator attribution, and any existing suggested defaults. A **game** is a particular play session with its own schedule, duration, teams, participants, submissions, review decisions, and results.

The organizer always confirms a game's duration and settings. Any template-level suggestion is only a starting value. Each game must snapshot its challenges, point values, order, and rules; editing a template cannot change a game already created from it.

A **participant** is a game-specific identity, associated with either an anonymous authenticated browser or a permanent account. A **team** can have multiple connected participants. A **montage** is the single shared video recap of one finalized game, not an individual or per-team video.

### 3.2 End-to-end workflow

1. An organizer creates an account/signs in, chooses an existing hunt or builds one, and creates a game.
2. The organizer configures timing, teams, assignment method, and any supported optional scoring rules.
3. Participants scan the appropriate QR code, enter their display name once, and join the correct game and team.
4. The organizer can join directly using Join this team beneath a team QR code.
5. The lobby shows team membership, rules, and start countdown, and prompts for a team selfie.
6. At the server-authoritative start, the simple challenge list becomes available automatically.
7. Players submit or replace photos. All teams see aggregate submission progress, without competing photos or answers.
8. At the deadline or an authorized early end, submissions close and the organizer conducts the group photo review.
9. The organizer rejects invalid entries and finalizes results. Ties are valid outcomes.
10. Results become available immediately; one private branded montage is queued automatically.
11. Once ready, the organizer and joined players can preview, download, and deliberately share the montage while authorized access remains valid.
12. Media can be deleted explicitly and, once a retention policy is approved, expires under that policy. Scores and completed-play counts are not dependent on keeping the media.

## 4. Version-one scope and non-goals

### 4.1 Included

Account-based organizing with isolated ownership; public hunt browsing and previously requested template reuse; streamlined creation and game management; named QR guests; organizer-as-player switching; both team-assignment modes; team selfie; reliable browser-session restoration; scheduled gameplay; all-team progress; camera capture and photo replacement; organizer-led quick review; finalized results and ties; one branded montage with verified music; guest download/share access; deletion controls; configurable expiry infrastructure; security and real-device tests.

Preserve any already working, explicitly enabled legacy team-voting behavior. It must not become mandatory or prevent a normal quick-review game from finishing.

### 4.2 Explicitly excluded for now

Native app packaging, subscriptions, ads, payment processing, AI photo judging, AI-generated videos, paid rendering services without approval, riddle/mystery progression, map/geofence gameplay, SMS, automatic social-account publishing, public participant-photo feeds, and a full offline gameplay/upload-queue system.

A separate creator leaderboard, ratings, new scoring modes, and additional game variants remain future or open unless already implemented under a prior approved instruction. Do not delete working features; flag conflicts and contain them rather than expanding their scope.

## 5. Hunt discovery, creation, and creator recognition

**Status: Carry forward; inspect the current v1.2 work before implementation.**

### 5.1 Discovery and publishing

**HUNT-01.** Anyone may browse public hunt templates without creating a permanent account. Starting or organizing a game requires one. Public discovery exposes only intended template content and creator display attribution, not account email, invitations, private games, or participant data.

**HUNT-02.** Original hunts become public through an explicit Publish Hunt action. Drafts remain unpublished. Customized copies remain personal and never silently alter the original. Before publishing, show exactly which fields become public.

**HUNT-03.** Preserve requested discovery capabilities: title search, newest/most-played sorting, creator attribution, and viewing another hunt by the same creator. Reuse existing venue/category filters where present. Ranking based on completed plays is not a quality rating.

**HUNT-04.** Count one completed play per finalized game, not per participant, QR scan, photo, page view, or repeated finalization request. Count within a transaction or another idempotent server operation. Deleting game media does not reduce the count. Treatment of test games, game deletion, or customized-copy attribution remains in the decision register.

**HUNT-05.** Public template text may be discoverable before a game starts. Enforce the game's pre-start access rules, but do not promise secrecy for text already published in the template library.

### 5.2 Hunt builder

Provide a guided path for title, venue, description, rules, challenges, and publication. A creator can select reusable ideas, add a new challenge, edit instructions and points, reorder entries, and save an editable draft. New challenge ideas continue to populate the creator's reusable library. Existing game snapshots are insulated from later edits.

Bulk entry accepts one challenge per line, trims whitespace, ignores blank lines, and presents editable entries before saving. Do not silently discard meaningful text or duplicate-looking items. Moving between steps must not lose unsaved work without warning.

Baseline limits include 2-12 teams, 1-100 challenges, item points from 0-1,000, and a game duration of 5-1,440 minutes; v1.1's form offered fewer duration choices. Verify current constraints and retain them unless a specific approved change requires otherwise. These are inherited limits, not a new scale guarantee. [B1, section 4]

## 6. Accounts, roles, and authorization

### 6.1 Organizer accounts

**AUTH-01. Confirmed.** A user needs a permanent account to author/publish a hunt, organize a game, or start it. Continue using the existing Supabase authentication method unless an approved change is necessary. Support isolated ownership for multiple organizers; an organizer profile does not grant access to every game.

The old one-provisioned-organizer gate must be reviewed against this product direction. Implement and test account onboarding in an authorized development environment; do not open public signups or change live authentication settings without approval.

**Implementation constraint.** The documented magic-link approach needs a production-capable email delivery configuration before broader organizer registration. Supabase's default SMTP is restricted and not intended for production. Report this configuration dependency; do not replace it with a paid provider or a different login system silently. [T2]

### 6.2 Guest participants

**AUTH-02. Confirmed.** Scanning an invitation and entering a display name admits a person to that game without requiring email, a password, or a permanent profile. Underlying anonymous authentication is an implementation detail, not a visible registration chore.

Use stable IDs, not names, for identity. Duplicate display names remain permitted. Preserve one participant record per authenticated identity per game and the existing display-name limits. A participant already joined to the game must not be silently reassigned by rescanning another team's invitation.

### 6.3 Organizer as player

**AUTH-03. Confirmed.** Under each organizer-visible team QR code, provide Join this team. This registers the organizer's existing authenticated identity as a participant in that team. It must not sign the organizer out or replace the account with a new anonymous identity.

After joining, provide Play / Manage Game switching. The same game, membership, session, countdown, and accepted submissions survive switching. Play has the same submission timing and replacement rules as everyone else; administration is a separately authorized capability.

Only that game's owner sees and can execute its management actions. Another registered organizer joining as a player has no management privileges for this game. Changing a browser view is never the authorization check.

### 6.4 Access summary

| Actor / phase | Permitted access | Not permitted |
| --- | --- | --- |
| Signed-out visitor | Public templates and safe invitation preview | Private game rosters, media, results, admin actions |
| Joined guest before start | Own team, rules, selfie flow, waiting room | Hidden game challenges or photo submissions |
| Joined participant during play | Own-team photos; all-team aggregate progress | Rival photos, rival per-challenge answers, admin controls |
| Joined participant during review | Authorized comparisons and provisional review results | Changing judgments or rules; claiming final results before finalization |
| Joined participant after finalization | Read-only final results and ready montage within access policy | Editing submissions, scores, timing, or retention |
| Game organizer | Management and retained game history; can also play | Managing another owner's game without an explicit granted role |
| Public template viewer | Creator attribution and completed-play count | Inferring private games or identities through the count endpoint |

## 7. Teams, QR check-in, and team selfies

### 7.1 Joining modes

**JOIN-01. Confirmed.** Organizer-assigned mode shows each team's QR code individually. The organizer can move between Team One, Team Two, and so on, display a code clearly on a phone, and use existing copy/print options. Players scan the intended code and register once.

**JOIN-02. Carry forward.** Balanced mode uses a shared invitation. The backend assigns a new participant randomly among least-populated teams under safe concurrent registration handling. Refreshes and repeated requests preserve the existing assignment. Pre-start organizer moves remain supported.

**JOIN-03. Engineering specification.** Preserve high-entropy, revocable invitation tokens and hashed storage. Rotation blocks new redemptions of old tokens but does not remove existing membership. A join link is not a permanent results-access credential. Reject new joins after the join window closes while allowing eligible existing participants to resume.

### 7.2 Selfie

**TEAM-01. Confirmed.** Prompt each team to capture one team selfie in the lobby, before the playing timer starts. It becomes the team's picture and the montage's team-introduction image. It contributes no challenge, completion count, or point.

Any eligible teammate can submit the team photo. Show who submitted it and synchronize the current image across the team. Reuse private-media controls and safe replacement behavior. A simultaneous upload must leave one authoritative active team image.

**Engineering default proposed:** A missing selfie does not block check-in or prevent a scheduled game from starting; use a team-name/color placeholder. Do not force all people to appear in a photograph. The exact replacement cutoff and optional opt-out wording are open decisions. Do not allow casual post-finalization replacement to silently change an already-created reel.

## 8. Session continuity and returning to a game

**SESSION-01. Confirmed and release-critical.** Scan once, enter a name once, and remain with the same game and team through normal phone locking, app switching, browser refresh, and reopening the same browser context.

On return, restore identity before attempting registration. Recover the game and team from trusted membership, then fetch authoritative phase, time, accepted submissions, and all-team progress. Restore the useful route/item/scroll location when still appropriate. If the game ended while the phone was locked, open the correct review/results view rather than an obsolete capture screen.

**SESSION-02. Engineering specification.** Do not create a fresh anonymous identity on every mount, treat a temporary network failure as sign-out, or call anonymous sign-in over a valid organizer session. Make join/rejoin operations idempotent. Show Reconnecting when necessary and preserve the current accepted-photo state until refreshed.

**SESSION-03.** Resume Realtime subscriptions and reconcile with a full authoritative fetch after reconnect. Device clock changes do not change deadlines. Tab suspension does not extend the timer. An interrupted upload remains pending/failed until the server confirms acceptance; persistence of membership is not proof of successful upload.

**Boundary.** Normal same-browser persistence is required. Private browsing, deleted site data, deliberate sign-out, a different browser/device, or moving to another website origin may lose the anonymous credential. Supabase does not automatically recover that identity. Do not promise otherwise or recover a player merely by matching a display name. [T1]

**Open decision:** A secure organizer-assisted recovery/rejoin mechanism for lost credentials. During development, give a clear explanation and recovery instruction; do not silently generate duplicate players. Preserve existing membership when an invited permanent-account user joins as a participant.

## 9. Game setup, lifecycle, and timing

### 9.1 Unified organizer workspace

**UX-01. Carry forward.** Main areas are Browse Hunts, My Hunts, My Games, and a prominent Create Hunt action. Challenge-library access belongs naturally in the hunt builder. Scheduling, team setup, invitations, live controls, review, and results live within the relevant game.

The game-management page follows Setup -> Lobby -> Active -> Review -> Completed. It emphasizes the action appropriate to the current phase. Draft editing, duplication, and existing archive/delete actions should not require unrelated menu navigation.

### 9.2 Start versus setup

**TIME-01.** Choosing Play This Hunt creates/opens game setup; it does not start consuming play time. Publishing/preparing a game creates valid invitations. The lobby shows teams, names, rules, duration, start status, and QR controls.

**TIME-02.** The organizer can use Start Now on an eligible pre-start game after confirmation. The server establishes the actual start and deadline from the configured duration. Existing registrations, team assignments, and invitations remain valid. A repeated request does not restart the clock.

**TIME-03.** Reschedule is a pre-start action. Add Time extends an active game's existing deadline. Both update connected players and are recorded. End Early requires confirmation and immediately closes submissions. Do not silently reopen an ended/completed game or add a late-submission grace period.

### 9.3 State authority

Keep game state and media-job state separate. An effective waiting/active/ended phase can be derived from stored schedule and server time without requiring a background process to change a row at the exact boundary. Preserve the existing status model where workable.

| Game phase | Player behavior | Organizer behavior |
| --- | --- | --- |
| Draft / setup | Not joinable | Configure hunt/game |
| Lobby / scheduled | Join, selfie, rules, countdown | Invite, move teams before start, reschedule, start |
| Active | Capture/replace within server window | Play; inspect progress; extend or end early |
| Ended / review | No new submissions; authorized comparisons | Review, reject, judge if enabled, finalize |
| Completed | Read-only final results; montage status/download/share | Retained management and history; media controls |

The backend checks membership, same-game associations, and effective phase for every privileged operation. Refreshing a stale page never restores expired permissions.

## 10. Field gameplay, photos, and live competition

### 10.1 Simple player interface

**PLAY-01. Confirmed.** The field interface centers on the challenge list, a large photo action, the timer, and easy access to all teams' progress. Do not turn it into a creator dashboard or social feed. Keep team identity visible and use understandable loading, success, and error states.

A challenge shows instructions, configured points, submission status, current own-team photo where available, and Submitted by attribution. Labels describe the authenticated submitter; they do not claim to verify who operated the camera. Preserve stable item ordering and useful filtering already present.

### 10.2 All-team progress bars

**PROGRESS-01. Confirmed.** Every joined team sees a bar for every team, labeled with team name, submitted count, and total challenge count, for example Team Blue: 12 of 20 submitted. A percentage may accompany the count. The purpose is friendly competitive pressure.

Count distinct challenge slots with an accepted active submission. The selfie and failed uploads do not count. Replacing the image in an already-filled slot does not increase the count. Progress is not weighted by item points and is not a final score.

Expose only aggregate counts during play. Do not send rival photo URLs, participant details, filenames, or per-challenge completion data to clients and merely hide them visually. Use a scoped aggregate server response or protected progress channel. Do not weaken submission-table policies to implement the bars.

Updates must reconcile after reconnect. A proposed acceptance target is within five seconds on the controlled healthy-network test setup, with visible reconnect/stale status during outages; record observed results rather than promise universal timing.

### 10.3 Camera and upload flow

**PHOTO-01. Carry forward.** Support iPhone Safari camera capture with browser-supported controls and a clear supported-image fallback. Maintain image orientation and aspect ratio. Preserve the existing resize/JPEG optimization approach, but verify actual input compatibility on devices rather than claiming every HEIC/HEIF file can be decoded.

The v1.1 baseline accepts browser-decodable inputs up to 20 MB, targets a longest edge of 1,600 pixels and approximately 800 KB, and configures an 8 MB output limit. Verify current code/storage limits before changing them. Re-encoding and size checks do not replace server authorization. [B1, section 4.6]

**PHOTO-02.** Distinguish Preparing, Uploading, Awaiting acceptance, Accepted, and Failed/rejected. Only a successful authoritative submission operation fills a challenge slot. Keep a selected image for retry where safely supported; do not promise survival across browser termination without implementing durable local storage.

**PHOTO-03.** One active photo per team/challenge remains the rule. Upload to a unique private path, validate and atomically register the submission, and only then retire the superseded image. A failed replacement preserves the previous accepted image. A version/check-and-set or equivalent mechanism prevents a stale client from silently overwriting a newer teammate submission.

**PHOTO-04.** Enforce the deadline using server time at authoritative acceptance, not the capture time reported by the device. Reject early/late/unauthorized attempts consistently. A timeout or uncertain response should be reconciled using a request identifier before retrying so acceptance is not duplicated.

## 11. Group review, judging, and final scores

### 11.1 Default: quick completion review

**SCORE-01. Confirmed.** Default to one point per valid challenge photo. Missing or rejected entries earn zero. Preserve game-specific point values for optional bonus/challenging items. Replacements do not earn extra points. Equal final totals share a rank.

**REVIEW-01. Confirmed.** After submissions close, the organizer walks the group through side-by-side comparisons. In quick review, accepted submissions are provisionally eligible unless explicitly rejected. The organizer need not click Approve on every obviously valid photo and need not choose a favorite for every item.

**Engineering specification:** Keep upload acceptance and judging disposition distinct. Existing pending statuses may remain in storage. For a new quick-review game, an explicit Finalize Results operation confirms all remaining non-rejected submissions under the displayed rule, computes scores, and stores the resolved results atomically. Do not silently finalize at timer expiry. Show the host the consequences before confirmation.

This intentionally changes v1.1's rule that every submitted photo must receive an individual decision. Preserve that stricter behavior for legacy/manual-review games instead of retroactively rewriting their rules. Save a per-game review/scoring policy snapshot.

### 11.2 Optional organizer judging

**SCORE-02. Confirmed direction; configuration details open.** The organizer may choose supported alternative judging rules before the game begins, including best-photo awards. Do not silently make the favorite photo the sole point-winner or assume a numerical bonus.

Until a specific alternative is selected and implemented, the default completion-scoring mode must work fully. Preserve existing approved item-point configuration. Clearly distinguish selecting a favorite for the reel from awarding scoring points.

### 11.3 Existing group voting

The latest discussion favors organizer judgment. It does not approve changing to one independent scoring vote per phone. Preserve any already-working optional one-effective-vote-per-team mode, no-self-vote restriction, and eligibility checks as a compatibility feature. Do not build a new individual voting system.

If legacy voting is enabled: zero votes produce no voting bonus; rejected photos cannot win; ineligible votes are excluded consistently; disabled voting never blocks finalization. Explain the automatic-tie limitation of two-team/no-self-vote voting. Handling an approval reversal must be consistent and tested. Any new award/tiebreak policy needs approval.

### 11.4 Presentation and finalization

**REVIEW-02.** Provide item-by-item comparisons, previous/next, missing-photo placeholders, submitter attribution, enlargement, reject/restore controls, and a legible scoreboard. Use readable grids/paging for larger team counts rather than unusably small thumbnails. Support desktop/TV display by a presentation-friendly browser layout; custom casting protocols are not required.

**FINAL-01.** Finalization is owner-authorized and idempotent. Store authoritative totals, item/bonus breakdown where applicable, and shared ranks; increment the applicable completed-play count once; enqueue the montage once. Repeated taps and retries do not double-count plays or awards.

Completed results are a snapshot. Score corrections after finalization are not casually editable in this scope; an explicit reopen/correction workflow would need approval and coordinated montage invalidation. The app must not display contradictory scores in the video and results page.

## 12. Post-game access, downloads, and sharing

**POST-01. Confirmed; version-one requirement.** Joined participants retain read-only access to final standings and the single game montage during the approved post-game access window. They do not need permanent accounts. Finalization is not an automatic sign-out or membership revocation.

The organizer retains the game's management and historical results. Participants cannot alter judgments, scores, submissions, timing, or deletion policy. An existing authorized session should return to the same game after closing/reopening the browser, subject to the documented session boundary in section 8.

**POST-02.** Show montage status separately from final scores: Queued, Creating, Ready, Failed/retry pending, Deleted, or Expired. Results remain usable if rendering fails. A participant cannot spawn new render jobs simply by refreshing or downloading.

**POST-03. Confirmed.** Provide video preview and download. Offer user-triggered file sharing where the browser/OS supports it, with download fallback. Do not promise that a website can save directly into every phone's Photos library or silently post to a specific social platform. Browser sharing requires supported capabilities and a user action. [T4]

**POST-04.** Keep server-hosted photos and video private to authorized game users. User-selected sharing sends the downloaded/exported video, not an organizer link, guest credential, team invitation, or storage secret. Do not request social-account passwords or create automatic posting integrations.

Before sharing, clearly explain that the reel includes other people's images and that the sharer is responsible for appropriate permission. Exported copies may remain on devices or social services after SnapQuest deletes its own copies. A score approval is not a legal permission to publish a person's image.

**POST-05.** Display actual available-until dates when policy is configured, including timezone and separate photo/video dates if they differ. In development, an unset policy must be labeled as unset; do not invent a deadline. New join attempts after closeout do not grant access to an old game merely because someone retained its QR code.

## 13. One automatic branded montage per finalized game

### 13.1 Required product behavior

**VIDEO-01. Confirmed.** Automatically initiate montage creation only after successful organizer finalization, not at the gameplay deadline. Generate one shared reel for the entire game, not a reel for each team or each viewer. All authorized viewers access the same current artifact.

**VIDEO-02. Confirmed.** The reel is both a family keepsake and a recognizable SnapQuest introduction. Use brand assets centrally so a later rename does not require rewriting the renderer. SnapQuest remains the working name; this document does not establish trademark clearance.

**VIDEO-03. Engineering storyboard proposal:** Branded opening with hunt/game title; team introductions with selfies or placeholders; selected qualifying challenge photos; finalized standings including tied places; branded closing invitation to play; required music credits. Represent teams fairly and avoid selecting a rejected entry as a successful challenge highlight. No generative AI is required for selection or assembly.

A small brand mark may remain during photos, with safe margins and readable text that does not obscure faces or challenge evidence. The closing call to action may use a configured public landing page. Never embed a private join token, results credential, email, or unpublished address. If no approved public URL exists, omit it rather than invent one.

**VIDEO-04.** Support background music from an approved catalog. Use real accepted game photos, not invented event images. Fit images without distortion; use deliberate transitions and optional challenge labels. Do not treat optional best-photo selections as evidence of a voting winner when no vote occurred.

### 13.2 Open presentation choices

The exact duration, aspect ratio, resolution, codec/export profile, number of selected photos, and selection/favorite controls remain to be chosen after a small render prototype. Prefer one tested initial output profile rather than multiplying render costs. A template-based renderer is the proposed implementation, not a selected dependency.

A private preview is required. Whether organizer release approval is needed before other joined participants can download the ready reel is open; do not silently introduce a permanent organizer-only restriction. Any media-consent/release gate must remain compatible with approved guest montage access.

### 13.3 Reliable rendering specification

Use a persistent job record with a unique game/finalization-version key and states such as queued, rendering, ready, failed, canceled, deleted, and expired. Snapshot the media selection, results, branding version, render profile, and approved music/license version in a manifest.

Retries reuse the same logical job, use bounded attempts, and cannot create unlimited videos. An interrupted worker must be recoverable through a lease/heartbeat or equivalent mechanism. Unauthorized guests cannot call privileged worker endpoints or read raw credentials.

Upload the completed video to private storage and publish its asset reference only after output validation. A failed render must not roll back final scores. An intentional re-render, if supported, is organizer-controlled, limited, and replaces the current artifact safely rather than accumulating indefinite versions.

Deletion or expiry wins over rendering: cancel eligible jobs, prevent uploading or publishing artifacts for a deleted/expired game, remove worker temporary files, and clean any late-arriving output. Do not allow a background retry to resurrect deleted media.

## 14. Rendering feasibility and operating-cost gate

**Engineering decision required before choosing infrastructure.** The current static client and Supabase SQL RPCs do not establish a working background video-rendering service. GitHub Pages hosts static assets, and Supabase Edge Functions impose bounded CPU, memory, and duration limits. Do not assume a normal function can encode arbitrary game videos or that GitHub Actions is an approved production media-rendering backend. [T5, T6]

Codex must perform a small technical evaluation and report:

| Question | Required evidence |
| --- | --- |
| Where will rendering run? | Candidate runtime, deployment permissions, dependency licenses, and limits. |
| What happens when every browser closes? | Demonstrated continuation or explicit limitation; never claim foreground browser work is durable background processing. |
| Can current phones play and share the result? | Actual iPhone and Android playback/download tests or a clearly named outstanding test. |
| What resources does a render consume? | Measured render time, peak memory where measurable, output size, and retry behavior. |
| Can it fit a no-paid-service development path? | Current allowances, possible charges, operational requirements, and stop conditions. |
| How is private content protected? | Worker access scope, signed-asset handling, private output, and temporary-file cleanup. |

A local or browser-based prototype may validate a template without committing to production hosting. If it depends on an organizer keeping a page open, label that limitation and seek approval before treating it as the shipped automatic workflow. A persisted job schema or fake progress animation alone does not complete the montage requirement.

Keep render-profile, storage, and processing interfaces separate from gameplay. Do not subscribe to a commercial video API, incur inference charges, or promise permanent zero cost at public scale. The owner must approve any ongoing-cost or hosting commitment.

## 15. Music rights and approved soundtrack catalog

**MUSIC-01. Confirmed.** Use free-to-obtain music with documented permission suitable for a potentially monetized app and videos that participants may download, repost, or monetize. Public availability and the phrase royalty-free are not sufficient clearance.

**Engineering recommendation:** Prefer a small vetted CC0/public-domain catalog, with appropriately licensed alternatives considered individually. CC0 permits commercial reuse but includes no warranty that all necessary rights are clear. CC BY allows commercial adaptation subject to its conditions. Creative Commons treats music synchronized with video as an adaptation, making NoDerivatives unsuitable for this ordinary workflow without separate permission. [T7, T8, T9]

The composition and the particular recording are separate works. Verify both, including third-party samples and the supplier's actual authority. Document app distribution, synchronization, copying, editing, and participant redistribution permissions. This is a clearance process, not a legal guarantee supplied by Codex. [T10]

**MUSIC-02.** Store a track catalog with title, creator, recording source, composition/recording-rights evidence, license/version/URL, retrieval and review date, reviewer approval, asset hash, required credit, modification notes, and enabled/disabled status. Keep evidence privately as needed; do not expose licensed source assets beyond their permissions.

**MUSIC-03.** Only approved tracks may enter an exported montage. Carry required attribution into the video and accompanying share information in a durable, readable form. Disabling a track prevents new use. Keep the license snapshot associated with existing renders for traceability.

No individual track has been approved by this PRD. A silent development render is an acceptable test fallback, not evidence that the music requirement is finished. Do not fetch random music automatically, use popular songs, or rely on a platform-specific music library for unrestricted cross-platform exports.

## 16. Media deletion, retention, and preserved history

### 16.1 Required now

**MEDIA-01. Confirmed.** Provide an obvious organizer control to delete stored game media, with a confirmation that identifies what will disappear: challenge photos, selfies, thumbnails, montage files, and relevant temporary derivatives. Separate Delete Media from Archive Game or any future Delete Game Records action.

Media deletion must not change finalized standings, reusable hunts, or completed-play popularity. Show Media deleted rather than broken thumbnails. Where removing an individual image from a game is supported, account for montages already containing it; do not suggest deleting the source removes the image from an exported video.

**Engineering proposal:** Restrict destructive bulk media cleanup to a safe ended/completed workflow, explain that deletion can prevent rendering, and coordinate cancellation before removing source assets. Development tools must not perform broad destructive cleanup against shared/live data without owner approval.

**MEDIA-02.** Delete actual objects through the Storage API, not only application rows or storage metadata. Track cleanup state, retry failures safely, and verify the objects are removed. Supabase explicitly distinguishes storage metadata from the stored objects. [T3]

### 16.2 Retention policy intentionally undecided

**MEDIA-03. Confirmed direction; numerical settings open.** Build a configurable retention/access model, not hard-coded 7-day, 30-day, or unlimited promises. Separate photo expiration, video expiration, and guest-results access where necessary. The policy must eventually cover completed, abandoned, and never-finalized games, as well as processing failures.

Before production expiry is enabled, approve the durations, the clock-start event for each asset, warnings, and treatment of failed renders. Protect legitimately in-use assets for a bounded approved period, not forever. Public rollout is gated on an explicit policy; controlled development can use manual deletion with an honest policy-not-set status.

Temporary uploads, superseded replacements, and failed-render artifacts are cleanup concerns distinct from the owner's undecided keepsake-retention window. They must not accumulate indefinitely under the excuse that long-term retention is undecided.

**MEDIA-04.** Preserve results and completed-play records independently of media. Do not assume that retaining scores requires retaining every name or photo forever; a later personal-data policy may limit those fields. Guest access after media expiry and the duration of organizer history remain separate open decisions.

## 17. Security, privacy, and accessibility requirements

**SEC-01.** Enforce ownership, membership, phase, and same-game constraints in trusted server operations and Row Level Security. Never trust a client-supplied organizer flag or team identifier. Anonymous authenticated users are not automatically organizers. Existing security-definer functions require explicit ownership/phase checks and restricted execution. [B1, section 7; T1]

**SEC-02.** Keep storage private. Authorize short-lived media access and renew it only while the user remains eligible. Do not store privileged credentials in a browser, QR code, public repository, exported video, or share link. Signed URLs are not immediate-revocation guarantees; document their short remaining lifetime and delete assets through storage when required.

**SEC-03.** Rate-limit join/invitation and expensive media endpoints, configure abuse protection before public registration, and prevent repeated renderer invocation through guest refreshes. Validate file size/type/path and preserve finalization idempotency. Keep sensitive tokens and photo contents out of logs.

**SEC-04.** Restrict private templates/games by owner, and public-library fields by intentional visibility. Test aggregate progress endpoints separately from photo access. A public play count is not an endpoint for enumerating underlying games or participants.

**PRIV-01.** Collect only needed names, membership/session IDs, game media, and timestamps. No participant email or precise location is required. Treat team selfies and challenge photos containing people as private game content. Keep venue/permission guidance visible and make sharing a deliberate act. Public-family/child participation and monetization need a separate privacy/legal review before launch; do not claim compliance from private buckets or one checkbox alone.

**A11Y-01.** Maintain readable text, labeled controls, visible focus, keyboard-operable organizer screens, large touch actions, status text in addition to color, and reduced-motion behavior. Countdown announcements must not overwhelm assistive technology. Preserve image aspect ratios; branding and credits must remain readable without covering the photographs.

## 18. Technical architecture and data evolution

### 18.1 Preserve the working stack

Keep React, TypeScript, Vite, Supabase Auth, PostgreSQL, current RPC business operations, private Storage, and Realtime. Retain existing CSS/component choices unless a local improvement is necessary. Do not introduce a replacement backend, global state rewrite, or new auth framework just to reorganize menus.

The core flow is:

**Web client -> authenticated Supabase operations -> game data and private media**

**Finalization -> durable render job -> approved renderer -> private montage asset**

**Authorized results view -> ready asset -> user download/share**

The renderer is a new separately evaluated component, not an assumed capability of the existing stack. Realtime signals prompt state refresh; they are not the authoritative record. Server time decides gameplay permissions.

### 18.2 Conceptual data changes; map to actual schema

| Concept | Necessary behavior / likely data |
| --- | --- |
| Organizer / creator | Permanent Auth identity, owner-scoped profile, chosen public display name |
| Hunt template / template items | Creator, publication state, reusable content, customization source if supported |
| Game / game items | Owner, source template, immutable item/rule snapshots, schedule, review policy, finalization version |
| Participant | Auth identity + game uniqueness, team, display name; permanent and guest identities supported |
| Team selfie | One current private asset per team, submitter, lifecycle and replacement metadata |
| Submission | Unique game/team/item, current private asset, version, submitter, acceptance time, review disposition |
| Final results | Stored authoritative totals/ranks and rule snapshot independent of media availability |
| Completed-play event | Unique qualifying game event; repeat finalization cannot inflate discovery counts |
| Montage job / asset | Unique game/finalization version, manifest, state, retry/lease data, current private output |
| Music catalog | Rights/attribution evidence, approved asset, version, approval status |
| Media lifecycle | Asset category, game owner, expiration/access policy, deletion state, worker coordination |
| Audit events | Timing changes, judgment/finalization, media deletion, and relevant privileged actions |

These names are conceptual, not required table renames. Preserve existing `hunts`, `hunt_items`, `hunt_votes`, and other tables where they can safely support the semantics. If v1.2 already separated templates and games, extend it rather than creating a second model.

### 18.3 Trusted operations

Review existing RPC/API contracts for publish/create game, invitation redemption, organizer joining a team, participant context, aggregate progress, submission acceptance, timing updates, review, finalization, media access, deletion, and rendering.

For each changed operation, document authorization, allowed phase, inputs, transaction boundaries, idempotency key or uniqueness rule, error states, and information exposed. Test hidden fields as well as visible UI behavior. For slow/locking operations, check time at actual acceptance after relevant locks, not only at an earlier client request.

## 19. Migration and release controls

**MIG-01.** Inventory the current repository, migration history, tests, and authorized environments before editing. Report implemented-and-verified, implemented-unverified, partial, missing, and conflicting behaviors separately.

**MIG-02.** Use additive, versioned migrations with an explicit mapping for legacy games. Legacy review settings remain legacy settings; new quick-review defaults do not retroactively change archived results. Do not recreate accounts, memberships, tokens, or private media merely to adopt terminology.

**MIG-03.** Apply and test migrations in local/approved test environments. Provide backup, rollback/forward-repair, and verification steps before requesting a shared/live migration. Do not reset Supabase, overwrite user work, or delete real games during tests.

**MIG-04.** Keep rendering, open registration, and new lifecycle policies behind appropriate configuration during development. Feature flags are not authorization. Do not mark a stub, disabled button, queued-but-unprocessed job, or mock video as completed production behavior.

**MIG-05.** Public deployment remains a separate owner-approved step. GitHub Pages is the historical web target, not a renderer. Its published restrictions require reassessment before using it for a commercial SaaS/monetized product; retaining GitHub source control does not require retaining Pages hosting. Do not change hosts or purchase infrastructure now. [T5, T11]

## 20. Acceptance and regression tests

Record the browser/device, backend/test environment, scenario, result, and actual evidence. Automated checks do not replace physical-phone tests. Each failed or unperformed check remains visible in the handoff.

| Test ID | Scenario | Required outcome |
| --- | --- | --- |
| AT-01 | Signed-out visitor browses and attempts to host | Public templates accessible; account required to create/start game. |
| AT-02 | Two organizer accounts access each other's game IDs | Private data/actions denied across ownership boundaries. |
| AT-03 | Team-specific QR registration | Correct game/team; name required once; no email/password needed. |
| AT-04 | Concurrent shared-QR joins and repeated submissions | Persisted balanced assignment; one participant per identity/game. |
| AT-05 | Rescan another team's QR after joining | No silent reassignment or duplicate participant. |
| AT-06 | Owner taps Join this team and switches Play/Manage | Same permanent identity/team retained; management still available. |
| AT-07 | Another organizer joins only as a participant | No management access to the host's game. |
| AT-08 | Lock/unlock, app switch, refresh, and reopen same browser | Return to correct game/team without name reentry or new identity. |
| AT-09 | Resume after deadline or after finalization | Authoritative phase restored; no expired upload controls. |
| AT-10 | Temporary connection loss / expired access token refresh | Reconnect without treating transient failure as a new registration. |
| AT-11 | Cleared storage or different browser | Honest recovery path; no identity claim based only on a name. |
| AT-12 | Selfie submitted/replaced or missing | One team image; private; no points/progress; documented missing-image behavior. |
| AT-13 | Scheduled start, Start Now, reschedule, Add Time, End Early | Server-consistent transitions; duplicate start does not reset clock. |
| AT-14 | Device clock is deliberately wrong | Server rules unchanged; displayed time reconciles. |
| AT-15 | iPhone/Android capture with representative images | Correct orientation/fit; supported formats; clear unsupported-file errors. |
| AT-16 | Upload succeeds but response is interrupted | Reconcile acceptance without duplicate submission or false failure. |
| AT-17 | Replacement fails or two teammates race | Prior accepted image protected; one final active image and cleanup path. |
| AT-18 | Upload finishes after deadline or early end | Consistent rejection; no client-timestamp exception. |
| AT-19 | Multiple teams submit and one replaces a photo | All progress bars update; replacement does not increase count. |
| AT-20 | Rival participant probes submission/progress endpoints | Counts permitted; rival photos/answers/paths denied during play. |
| AT-21 | Quick-review game with valid, missing, and rejected entries | Non-rejected accepted entries earn configured points on explicit finalization. |
| AT-22 | Legacy manual-review game retains pending entries | Legacy finalization behavior preserved; no retroactive rule change. |
| AT-23 | Equal final totals | Shared ranks; no forced speed tiebreak. |
| AT-24 | Optional voting: zero votes, self-vote, duplicate, rejected photo | Correct eligibility; no zero-vote award; one effective team vote. |
| AT-25 | Repeated finalize / network retry | Same results; one completed-play count and one logical montage job. |
| AT-26 | Timer expires but organizer has not finalized | No montage generation yet. |
| AT-27 | Finalize while renderer unavailable | Results visible; job failure/pending explicit and safely recoverable. |
| AT-28 | Render valid game with absent selfie and tied winners | Branded real video, correct placeholders, eligible photos, correct standings. |
| AT-29 | Unapproved/disabled music selected | Excluded from export; approved tracks retain required attribution. |
| AT-30 | Guest closes browser and returns after completion | Read-only results and ready reel available during authorized window. |
| AT-31 | Share supported/unsupported; user cancels sharing | User-triggered share or download fallback; cancellation is not upload failure. |
| AT-32 | Organizer deletes media during queued/running render | Job cannot resurrect assets; cleanup verified; results/count preserved. |
| AT-33 | Expiry boundary and failing deletion retry | Honest expiry UI, server restriction, actual object cleanup when configured. |
| AT-34 | Unset retention policy in development | No invented dates, timed deletion, or unlimited-retention promises. |
| AT-35 | Edit public template / customize personal copy | Original and game snapshots protected; no unintended publication. |
| AT-36 | TV review, long names, many teams, keyboard/reduced motion | Readable comparison, navigable controls, no clipping or forced animation. |

Run available TypeScript, lint, unit/integration tests, and production build. A workstation permission problem is a reported blocker, not a passing build. The two most important physical-device regressions are returning to a live game after phone lock and returning later to guest results/montage.

## 21. Phased Codex implementation plan

| Phase | Deliverable | Gate before proceeding |
| --- | --- | --- |
| 0. Current-state audit | Requirement-to-code map, actual migration inventory, verification gaps, small implementation plan | Identify real conflicts; do not assume old prompt equals implemented code. |
| 1. Check-in and hosting | Safe organizer-as-player flow, Play/Manage switch, unified game context, session-restoration fixes | Authorization/session tests pass; report physical-phone tests still needed. |
| 2. Field experience | Selfie, simple list, all-team aggregate progress, reliable capture/replacement, timing controls where missing | Multi-device/privacy/deadline regression checks; no rival-photo leakage. |
| 3. Review and outcomes | Quick-review policy, side-by-side host flow, ties, idempotent finalization, guest results access | Legacy scoring preserved; results independent of media state. |
| 4. Montage feasibility | Small genuine video prototype; runtime/cost/license recommendation; job/manifest design | Owner approves unresolved infrastructure/profile/music choices. |
| 5. Montage and media | Automatic render integration, branded reel/music, guest download/share, coordinated deletion and expiry-ready UI | Real rendered artifact, device playback, rights evidence, deletion tests. |
| 6. Release readiness | End-to-end family game, security suite, onboarding/email configuration, approved retention policy and operational instructions | Owner-approved public deployment; no remaining hidden production blocker. |

Implement in reviewable increments. The first authorized batch should be the smallest useful work supported by the audit; do not redo phase-one features already complete. After each major phase, report changes, evidence, unverified items, migrations/configuration required, and the next proposed batch.

The phase order is not permission to drop montage, guest post-game access, or deletion from version one. It separates delivery dependencies from scope.

## 22. Open decisions and safe development behavior

| Decision ID | Unresolved question | Until decided |
| --- | --- | --- |
| D-01 | Photo/video retention periods, start events, abandoned-game policy, and warnings | No production TTL or purge schedule for retained game media. Implement manual deletion and configurable fields. |
| D-02 | Guest results access after media expiry; organizer personal-data history | Keep those policies separate; do not claim permanent guest access or silently delete scores. |
| D-03 | Rendering runtime, operating costs, and closed-browser behavior | Prototype and measure. Do not commit to paid hosting or claim browser-bound work runs independently. |
| D-04 | Initial video duration, orientation, resolution, and highlight-selection rules | Propose one profile and deterministic selection for approval; no arbitrary fixed promise. |
| D-05 | Exact music tracks and complete rights evidence | No uncleared music in export. Silent tests remain explicitly incomplete music implementation. |
| D-06 | Optional best-photo scoring: bonus versus winner-only, amount, and tie handling | Completion scoring remains default. Preserve existing supported configuration only. |
| D-07 | Lost-guest-credential recovery; selfie replacement cutoff/opt-out | Do not equate names with identity; use documented placeholder behavior and ask before broader changes. |
| D-08 | Public account provisioning/email provider and moderation before open creation | Controlled development/test accounts only until configuration and release approval. |
| D-09 | Customized-copy/test-game treatment in popularity; separate creator leaderboard | Do not alter existing ranking silently. Finalization remains once-per-game. |
| D-10 | Organizer release approval for montage distribution to joined guests | Present the choice without reverting to permanent organizer-only access. No automatic public posting. |
| D-11 | Final brand name, production landing URL, and commercial hosting | Keep branding configurable; use SnapQuest as working name, no name-clearance claim. |

Do not ask the owner to reconfirm settled mechanics. Raise open decisions as a short consolidated list only when they block the next specific implementation step. Independent usability, testing, and data-safety work should continue.

## 23. Future direction, not current implementation

After the web product is dependable and visually satisfactory, evaluate public iOS/Android apps, a free/paid offering, advertising, and the economics of storage and video generation. Do not assume the paid tier is merely ad-free; pricing, entitlements, advertising placements, and revenue projections have not been decided.

Reusable mystery adventures, riddles, clue sequences, photo-answer verification, and AI judging remain promising exploratory ideas. Inference costs, correct-answer reliability, creator tooling, hints, and fallback/appeal behavior must be evaluated before committing. None is required to deliver the regular photo-hunt workflow.

A more elaborate creator leaderboard, paid content marketplace, AI curation, offline submission queue, direct social publishing, and new game modes are not authorized merely because they appeared in research.

## 24. Definition of done

Version one is ready only when an account-holding organizer can prepare a hunt/game, invite named guests, join a team, switch safely between playing and management, run a timed hunt with all-team progress, review photos with completion-based scoring, and finalize valid results including ties.

Participants must remain with their game through ordinary phone/browser interruptions and return to read-only results and the shared montage without creating accounts. A genuine SnapQuest-branded, music-backed video must be generated after finalization using an approved operating approach and cleared music; preview, download, and supported sharing must work. A failed render must not invalidate the results.

Manual media deletion must be effective, including derivative outputs and render races. Retention periods, guest access expiry, production organizer authentication/email delivery, privacy/abuse controls, and the rendering runtime must be explicitly resolved before public rollout. Final results and popularity must survive ordinary media cleanup.

A successful production build, critical automated tests, multiple physical phones, authorization-denial tests, and owner release approval are all required. An implemented screen, a passing lint check, or an unprocessed video job is not end-to-end completion.

## Appendix A. Sources and traceability

### Product sources

**[B1] Supplied baseline:** SnapQuest_Product_Requirements_Document_v1.1.docx, October 29, 2026. Relevant sections: 2 roles; 3 flows; 4 functional requirements; 5 architecture; 6 data; 7 security; 9 implementation/verification; 11 open risks; 13 deferred features. Historical implementation statements are attributed to this document.

**[B2] Product-owner discussion:** This conversation, including the November 2 confirmations about all-team progress, organizer-as-player, quick review and ties, team selfie, one branded montage after finalization, guest results/video access, persistent joining, verified music, and undecided retention periods.

**[B3] Prior Codex instructions:** Earlier improvement prompt and the owner's statement that it was supplied to Codex. These are requirements/change history, not independent evidence of the resulting code.

### External implementation notes

The following primary documentation was checked on November 2, 2026. These references explain technical constraints; they do not add approval for new paid services, select a soundtrack, or substitute for legal review. Recheck service terms when configuring a release.

**[T1] Supabase - Anonymous Sign-Ins.** Guest identity, authenticated role, and recovery limitations. https://supabase.com/docs/guides/auth/auth-anonymous

**[T2] Supabase - Send emails with custom SMTP.** Production organizer-email configuration. https://supabase.com/docs/guides/auth/auth-smtp

**[T3] Supabase - Storage Schema; Delete Objects.** Metadata versus stored files and API-based deletion. https://supabase.com/docs/guides/storage/schema/design ; https://supabase.com/docs/guides/storage/management/delete-objects

**[T4] MDN - Navigator.share().** User activation, supported file sharing, and browser limitations. https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share

**[T5] GitHub - What is GitHub Pages?** Static-site hosting. https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

**[T6] Supabase - Edge Functions limits.** Runtime resource boundaries; not a render-performance guarantee. https://supabase.com/docs/guides/functions/limits

**[T7] Creative Commons - CC0 1.0.** Commercial reuse and no-warranty caveat. https://creativecommons.org/publicdomain/zero/1.0/

**[T8] Creative Commons - CC BY 4.0.** Commercial adaptation and attribution conditions. https://creativecommons.org/licenses/by/4.0/

**[T9] Creative Commons - FAQ.** Music/video synchronization and license restrictions. https://creativecommons.org/faq/

**[T10] U.S. Copyright Office - What Musicians Should Know about Copyright.** Separate composition and recording rights. https://www.copyright.gov/engage/musicians/

**[T11] GitHub - GitHub Pages limits.** Commercial hosting restrictions to reassess before monetization. https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
