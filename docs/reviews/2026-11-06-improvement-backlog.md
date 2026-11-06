# SnapQuest improvement backlog

Created November 6, 2026 from the [deep review](2026-11-06-deep-review.md), [remediation status](2026-11-06-remediation-status.md), PRD v2 checklist, and product roadmap.

## Objective

Close the review's remaining verification gaps, strengthen the production organizer/player journeys, and align product documentation with the shipped application. Work top to bottom in small, independently testable releases. Every code or database change must be pushed to GitHub, pass the local checks, pass the Pages workflow, and have its served commit verified before it is marked complete.

This backlog intentionally distinguishes **implementation** from **observed acceptance**. A passing unit test or green build does not count as a phone, browser, Storage HTTP, or multi-device test. Use a dedicated test hunt and test identities; do not run destructive scenarios against real user hunts.

## Current status

- IMP-01: complete and live in commit `26375bd`; workflow `42287341216` passed and the served build manifest matched.
- IMP-02: in progress. Browser tests now cover valid invite preview, invalid invite, organizer email request and restored organizer session, participant return-home, organizer team-return link, and a mocked participant join into the waiting lobby. Add authenticated gameplay, review, and published-results routes.
- IMP-03: in progress. Home, organizer, and player lobby now have 320/375/390-pixel overflow checks; home has 200% text-size and keyboard checks, and home/organizer/player lobby have automated axe scans. Fixed missing form focus, organizer decorative-banner overflow, low-contrast labels, and the hidden selfie input expanding the player page. Broaden to active game/review/results; record real-device and screen-reader observations.
- IMP-04: in progress. Storage delete errors and thrown network failures now queue cleanup retries, including failed upload rollback and replaced media cleanup. Failed retry outcomes emit privacy-safe operation events. Fault-injection tests cover returned/throwing delete failures and successful retry; remaining upload-denial, RPC reconciliation, signed-preview, and replacement-race cases are not yet covered.
- IMP-05–IMP-18: queued in the order below.
- IMP-19: in progress. Existing code already supports participant cards, multiple positive tied winners, zero-score no-winner, missing-selfie color fallback, measured long-name fitting, share cancellation handling, and preview URL cleanup. This pass adds explicit tie language to the card and share caption; remaining canvas/device walkthroughs are outstanding.
- IMP-17: in progress. Added phone regression coverage and corrected decorative overflow in the organizer workspace. Continue through lobby status, QR/copy link placement, roster, chat, start/end, and play/manage switching with an organizer-player acceptance walkthrough.
- IMP-20: in progress. Lazy-loaded organizer, participant, and invite routes reduced the initial entry from about 170 KiB to 135 KiB gzip. The build enforces a 150 KiB gzip budget; browser checks assert home does not request those route chunks. CI exposed a Pages-prefix path issue in the size script; corrected locally, pending rerun and deployment.
- IMP-21–IMP-24: queued in the order below.
- No item is complete until its acceptance evidence and published commit are recorded here.

## Work order

### Wave 1 — Correctness and release confidence

| ID | Priority | Improvement | Completion evidence |
| --- | --- | --- | --- |
| IMP-01 | P1 | Let organizers correct approve/reject decisions while review remains open. Preserve the finalized-results lock. | Shipped in `26375bd`; PGlite regression confirms decisions can change both ways during review and cannot change after finalization. GitHub Actions run `42287341216` passed; live `build-info.json` matched the commit. |
| IMP-02 | P1 | Add a production-route browser suite for home, invite entry, guest recovery, organizer entry, player/organizer switching, review, and completed results. Use isolated fixtures or mocked service responses where external services are not needed. | In progress: browser checks cover home, valid/invalid invite, email-link request, restored organizer workspace with team return link, unavailable-session return home, and participant join into the lobby; these pass on desktop/mobile Chromium locally. Authenticated gameplay, review, and published results remain. CI’s latest failure was the bundle checker assuming root-hosted assets, now corrected locally. |
| IMP-03 | P1 | Add responsive layout checks at 320, 375, and 390 CSS pixels, plus 200% text zoom and keyboard-only navigation for home, play, lobby, review, and results. | In progress: home, organizer, and participant lobby responsive checks plus home/organizer/player-lobby axe checks pass locally; home 200% text-size and keyboard checks pass. Fixed focus transfer, overflow, and contrast issues. Extend to active gameplay/review/results and document manual real-device/screen-reader tests. |
| IMP-04 | P1 | Exercise photo and selfie upload failure stages: upload denial, RPC rejection, lost response after commit, replacement race, and signed-preview failure. | In progress: cleanup is retried after returned or thrown Storage delete failures, including failed upload rollback and replacement cleanup. Non-sensitive failure stages are logged. Unit fault-injection covers delete failures and successful retry; upload denial, uncertain RPC reconciliation, signed-preview failure, and two-device replacement race still need dedicated coverage. |
| IMP-05 | P1 | Verify Storage authorization through actual HTTP requests, including pre-start/manual-start upload, cross-team access denial, referenced-object deletion denial, and cleanup of an unreferenced object. | Dedicated test project produces request/response evidence for each policy case; production data is untouched. |
| IMP-06 | P1 | Run concurrent review/finalize and two-device photo replacement tests against PostgreSQL, where row locking and ordering are real. | Races consistently leave either a mutable review or one immutable final snapshot; stale photo versions cannot replace newer versions. |
| IMP-07 | P1 | Complete the lifecycle matrix for manual and scheduled hunts, timer expiry, early end, review, empty hunt, finalization retry, and intentionally incorrect device clocks. | Browser and database evidence agree on the server-authoritative state at every transition; no upload is accepted past the server deadline. |
| IMP-08 | P1 | Verify score, rank, voting, and winner agreement across SQL, organizer results, participant results, and celebration output. | Fixtures cover vote-driven winner changes, rank ties, tie below first, all-zero results, rejected submissions, and retry after a lost finalize response. |

### Wave 2 — Reconnect, privacy, and operations

| ID | Priority | Improvement | Completion evidence |
| --- | --- | --- | --- |
| IMP-09 | P1 | Test team membership, team moves, team names, and selfies from two authenticated devices with realtime interrupted and restored. | Roster and selfie state converge via realtime or fallback without manual reload; a failed preview remains distinct from no selfie. |
| IMP-10 | P1 | Keep review and participant galleries correct while approvals/votes change and signed image URLs expire. | Leave a test screen open beyond the signed URL lifetime, background/restore it, and verify images renew and votes/results converge. |
| IMP-11 | P1 | Verify invite recovery on a second organizer device, after local storage is cleared, after invitation rotation, and after hunt closure. | Only active codes appear; old links fail after rotation; closed hunts show a clear closed state; participants can still resume using their membership. |
| IMP-12 | P1 | Test email magic-link return paths and browser back/forward for guest and permanent accounts. | Same-origin callback returns to the intended public, player, or organizer route without losing the participant identity or opening the wrong hunt. |
| IMP-13 | P1 | Stress chat recovery, paging, lifecycle, rate limits, and timing controls together. | More than 100 messages can be paged in order; reconnect retrieves gaps; closed hunts are read-only; spam is bounded; Start/End remain responsive under the intended group size. |
| IMP-14 | P1 | Verify troubleshooting traces for RLS denial, uncertain media response, preview failure, chat failure, review change, and finalization retry; define log retention. | Each trace is findable by operation ID; event rows are labeled client-reported or server-authoritative; no tokens, signed URLs, paths, photos, emails, or message bodies appear; retention/cleanup is documented and tested. |
| IMP-15 | P1 | Run a role-boundary review of organizer, participant, anonymous, non-member, and closed-hunt access for RPCs, tables, Storage, logs, and invitations. | A written threat-case matrix has positive and negative live test results; no claim relies on hidden UI controls as authorization. |

### Wave 3 — Production workflow and usability

| ID | Priority | Improvement | Completion evidence |
| --- | --- | --- | --- |
| IMP-16 | P2 | Unify the authenticated production hunt editor with the reusable challenge editor and shared domain rules; remove duplicated behavior between production and development preview. | Create, reopen, edit, reorder, and publish through the same tested components/contracts; edits to a reusable source never mutate a published game snapshot. |
| IMP-17 | P2 | Review the organizer's end-to-end lobby hierarchy on phones: status, play/manage switch, start/time controls, QR and copy links, roster/readiness, chat, and detailed controls. | In progress: phone-width regression now catches and fixes decorative overflow on the organizer page; participant lobby’s hidden file control was also constrained after it caused 61 px of page overflow. Still need a first-time organizer/player task walkthrough for Start, Copy team link, Join as organizer, Return to team, End, and Review, with copy links beside the QR codes. |
| IMP-18 | P2 | Improve chat and live-screen feedback with visible offline/reconnecting state, new-message count when scrolled away, and retry guidance for each failed action. | Accessibility tree announces state changes; new messages do not force-scroll a reader; the user can jump to latest or retry a failed fetch. |
| IMP-19 | P2 | Finish celebration-card polish: copy caption, display the winning team's selfie when available, clear no-selfie fallback, long-name wrapping, tie language, cancellation, and unsupported-share download fallback. | In progress. Code already offers participant cards, supports multiple positive tied winners, omits a winner card at zero points, uses team color when a selfie cannot load, shrinks long text to fit, handles share cancellation, and revokes preview URLs. New work labels tied cards/captions accurately, with unit coverage for captions and safe filenames. Still need canvas assertions and Safari/iOS/Android checks for winner, tie, zero-score, missing selfie, long names, cancellation, and share/download fallback. |
| IMP-20 | P2 | Add performance budgets and reduce the current ~600 KB minified JavaScript entry bundle with route-level lazy loading. | In progress: lazy-loaded organizer, participant, invite, and development routes reduced initial JS from 600 KB / 170 KB gzip to 472 KB / 135 KB gzip. Build enforces a 150 KiB gzip entry budget; browser test checks home does not fetch organizer/player route chunks. GitHub run `42289992187` failed because the checker used the Pages base prefix as a physical directory; script now finds the `/assets/` segment. Await successful CI/deployed build. |

### Wave 4 — Product and documentation alignment

| ID | Priority | Improvement | Completion evidence |
| --- | --- | --- | --- |
| IMP-21 | P2 | Reconcile the PRD v2 checklist, test evidence, roadmap, and shipped feature ledger with migrations 001–022 and the production workspace. | Every listed requirement has one current status, code pointer, test evidence, and an explicit deferred/missing explanation; obsolete claims are corrected without deleting history. |
| IMP-22 | P2 | Define a privacy and lifecycle policy for team selfies, submissions, finalized results, invitation secrets, and diagnostic events, including deletion and retention behavior. | Policy states who can view/delete each asset, when access expires, what cleanup does after failure, and what remains for finalized scores; UI copy matches server behavior. |
| IMP-23 | P2 | Exercise the release workflow under rapid main pushes and a simultaneous PR run. | PR validation cannot cancel a publish; publish jobs serialize; the final live manifest equals the newest successfully tested commit. |
| IMP-24 | P3 | Keep video generation, music, direct social integrations, and AI hunt generation behind explicit future design/cost/rights gates. | No premium implementation begins until operating cost, licensing, retention, privacy, failure recovery, and user value are documented and approved in the roadmap. |

## Execution method

1. Start with IMP-01 because the review currently allows a server-side decision correction but the review screen only offers actions for pending photos.
2. Add a regression test before or with each fix. Prefer deterministic unit/PGlite coverage; add browser and dedicated-project tests where those layers are required.
3. Use a dedicated test project and synthetic hunts for hosted behavior. Record exact environment and observations; never expose credentials or real participant media.
4. Run `npm.cmd test`, `npm.cmd run lint`, and `npm.cmd run build` after each coherent code batch.
5. Commit and push every completed batch. Confirm the matching GitHub Actions run, migration history when relevant, and live `build-info.json` before marking it shipped.
6. Update this backlog row with commit, migration, test/deployment evidence, and any verification limit. Do not mark observed acceptance complete when only code or mocks passed.

## Not in this cycle

The optional video montage, licensed music catalog, direct social-network posting, and AI-generated hunt authoring remain deferred product work, consistent with `docs/PRODUCT_ROADMAP.md`. IMP-24 is a planning gate, not a commitment to build those services now.
