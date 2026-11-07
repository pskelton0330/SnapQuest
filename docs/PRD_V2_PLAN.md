# SnapQuest version one delivery plan

Controlling specification: `SnapQuest_Revised_PRD_v2.0.md`, document revision 2.0, November 2, 2026. This is an incremental version-one product plan, not an application rebuild or a release named 2.0.

> **Status note (November 7, 2026):** The phased sequence below preserves the original PRD implementation proposal and is not a statement of current release status. The authenticated production app is deployed at [GitHub Pages](https://pskelton0330.github.io/SnapQuest/); current feature, test, and release status is maintained in [PRD_V2_CHECKLIST.md](PRD_V2_CHECKLIST.md), [PRD_V2_TEST_EVIDENCE.md](PRD_V2_TEST_EVIDENCE.md), and [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md). The roadmap defers video generation, licensed music, direct social posting, and AI hunt generation beyond the lean core launch. Production history records migrations 001–024 and targeted 026–028; migration 025 audit retention is unapplied and requires explicit approval. See the checklist and evidence for current status.

## Phase sequence

1. Check-in and hosting. First batch restores Auth before invitation actions, resumes permanent and guest identities with trusted membership, fails safely on restoration errors, and reconciles game context after focus/online/visibility return. Next batch adds owner-checked Join this team and Play/Manage switching in the retained authenticated flow. Review controlled account onboarding and common game context separately; do not open live signups. Existing preview remains a UI sandbox, not a substitute for account-based hosting.
2. Field experience. Add scoped all-team aggregate progress without broadening submission reads. Add private one-current-selfie support; clarify replacement cutoff/opt-out D-07 before that behavior. Add submission-stage feedback, response reconciliation, compare-and-set replacement and cleanup retries. Preserve hard server cutoffs and existing timing limits; add timing audit records.
3. Review and outcomes. Add per-game quick/manual policy with legacy games explicitly manual. Quick review resolves eligible non-rejected submissions only on confirmed finalization. Use stored authoritative results and dense ties; preserve optional team voting. Add idempotent completion and one logical job per finalization, plus guest read-only outcomes without an invented expiry duration. Job persistence alone does not deliver video.
4. Montage feasibility. Produce a genuine bounded prototype, measure time/output/memory where possible, evaluate closed-browser behavior, private-media scope, licenses and costs. Propose one deterministic storyboard/output profile. Obtain approval for unresolved runtime/profile/music choices before commitment.
5. Montage and media. Integrate an approved durable renderer, validated private output, verified music catalog, guest preview/download/deliberate sharing, coordinated media deletion and retries. Results/play counts survive media deletion. Retention/access fields may be unset in controlled development; no production TTL until approved.
6. Release readiness. The original PRD release gate called for approved email/onboarding, abuse controls, retention and guest policy, multiple physical phones, renderer playback/sharing, ownership/RLS tests, a successful production bundle, and explicit release approval. This original proposed sequence is historical; consult the current checklist and roadmap for active scope.

Each batch stops for review. Montage, guest access and deletion remain required version-one scope even while their gates are unresolved.

## Decision log

2026-11-04: Adopt the lean-launch sequence recorded in `PRODUCT_ROADMAP.md`. Build the winner celebration card immediately after the current core hunt flow. Defer server-rendered video, automatic social-network publishing, and AI-assisted hunt generation until the core experience has proven reliable and the costs, permissions, privacy, and operational model are approved. The broader PRD requirements remain the long-term reference; this changes sequencing, not their documentation.

2026-11-03: Applied and remotely verified migrations 001–010. A controlled production hunt completed the live path through Start Now, photo capture, organizer review and server-calculated scoring. Continue with the remaining Phase 2 reliability/security work before beginning montage feasibility.

2026-11-02: Adopt v2.0 over conflicting older decisions. Preserve React/TypeScript/Vite/Supabase and migrations 001–008. Keep local-only UI refinement separate from authenticated gameplay. Implement session restoration first because it requires neither new schema nor open decisions. Do not claim full Phase 1 complete: host switching, last-game navigation, reconnect status, onboarding and real-phone continuity remain.

Confirmed changes awaiting later implementation: quick review is the default for new games; legacy manual review remains intact. All players see all-team accepted-slot counts only. Hosts participate under their permanent identity. Finalization triggers one branded music-backed game montage; timer expiry does not. Joined guests retain authorized read-only results and video access. No retention numbers have been approved.

Open gates retained from PRD: D-01 retention durations/start events; D-02 guest results after expiry and organizer history; D-03 render runtime/cost/closed-browser behavior; D-04 video profile/selection; D-05 exact tracks and rights; D-06 optional best-photo points; D-07 lost-credential recovery/selfie cutoff/opt-out; D-08 public onboarding/email/moderation; D-09 popularity attribution for tests/copies; D-10 organizer release approval before guest video download; D-11 final branding/production URL/commercial hosting. None blocks the session batch.

## Migration and configuration boundaries

Current live state checked November 7: production history records migrations 001–024 and targeted 026–028; 025 installs proposed 365-day audit-event pruning and remains unapplied pending explicit operator authorization. Migration 028 publication membership was verified before recording it applied. Recheck live versions before future migrations.

The first-batch historical notes below predate many later migrations and do not describe the current production schema. The v1.1 document historically reports 001–006 applied; the November 6 remote history check supersedes that older snapshot. All later schema changes still require an additive migration, review, isolated hosted validation, and explicit approval before production application.

Future schema proposals must be additive and reviewed: template publication/drafts, team selfies, submission versions/idempotency, timing audit, per-game review policy, completed-play event, finalization/job uniqueness, music catalog, media lifecycle and deletion coordination. Provide backup, legacy mapping, local tests and forward-repair/rollback instructions with each proposed migration before requesting shared/live approval.

No provider/runtime/music/hosting recommendation is yet approved. Verify current provider limits and rights sources when those workstreams begin; this audit makes no new legal, pricing or capacity claim. Production email setup and controlled organizer onboarding remain configuration gates. Do not introduce a paid provider or open registration.

## First batch operation contracts

`restoreParticipantSession`: use existing SDK getSession; preserve permanent or anonymous identity; propagate restoration errors; create anonymous session only during explicit join when SDK confirms no session. No sign-out, profile change or ownership grant.

`resumeInvitation`: restore identity, then redeem with empty name. Existing SQL returns the identity/game membership before revoked-token or new-join-window checks; blank name cannot create a new participant. Only the known name-required response opens the form. Other errors show retry rather than starting over. Permanent and guest identities follow the same path.

`joinInvitation`: validate name, restore Auth again at submission time, create a guest only if genuinely signed out, then call existing redemption RPC. RPC locks the game and enforces unique identity/game membership and stable team assignment; a retry uses that same trusted membership. Returned membership, not a client team/organizer flag, controls navigation. Ambiguous responses remain unconfirmed and retryable. This does not implement photo request identifiers.

The existing redemption RPC permits eligible new joins only while scheduled/active, and permits existing members to resume after closeout or invitation rotation. Cross-owner administration is denied separately by existing ownership checks. No new SQL operation was introduced.

Participant foreground/online reconciliation fetches authoritative context, which triggers existing item/submission refresh. Existing accepted-photo state is retained until that refresh. This is not a durable offline upload queue or proof of live Realtime delivery. Current signed-URL refresh failures and response-race handling remain part of later photo/reconnect work.
