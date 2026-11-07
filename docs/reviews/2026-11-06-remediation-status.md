# SnapQuest deep review remediation status

Updated: November 7, 2026
Source: [deep review](2026-11-06-deep-review.md) and [remediation plan](2026-11-06-remediation-plan.md)

## Release evidence

- Current checkout `aec25ad`: `npm.cmd test` 80/80 passed; `npm.cmd run test:e2e` 98/98 Chromium desktop/mobile browser cases passed; lint and build passed. Browser checks include keyboard navigation and 200% text-size coverage for participant and organizer flows. The production JS entry is 135.05 KiB gzip against the enforced 150 KiB budget.
- Latest deployed revision `aec25ad` passed [GitHub Actions run `42337997142`](https://github.com/pskelton0330/SnapQuest/actions/runs/42337997142), including unit/database tests, 98 desktop/mobile browser cases, lint, build, and deploy. The [live manifest](https://pskelton0330.github.io/SnapQuest/build-info.json) matched the full `aec25ad06d04c57c4a27e014c2d6652f0f1e3928` SHA when checked.
- The [PRD v2 crosswalk](../PRD_V2_BACKLOG_CROSSWALK.md) now maps all 56 checklist requirements to remediation, evidence gates, deferred product scope, or owner decisions. It does not represent broader PRD completion.
- Supabase production migrations 001â€“022 are applied to project `ykfkwczcomkhxaraqpuq`.
- The current evidence proves the automated/mock-backed journeys listed in the test evidence; it does not prove hosted Storage HTTP policy behavior, multi-session PostgreSQL races, or physical-device acceptance. Use the [improvement backlog](2026-11-06-improvement-backlog.md) for per-item gates and outstanding decisions.

## Finding ledger

| Finding | Status | Implementation / evidence |
| --- | --- | --- |
| R01 | Fixed | Anonymous participants can reach public home without losing their participant identity; guest and organizer route tests pass. |
| R02 | Fixed | Natural expiry exposes the explicit server-authoritative Start photo review action; migration 016 and lifecycle tests cover the transition. |
| R03 | Fixed | Completed views use stored final scores; vote payload normalization and dense ranks are tested. |
| R04 | Fixed | Migration 016 locks and guards review/finalization; completed retries return the stored snapshot. |
| R05 | Fixed | Upload, acceptance, uncertain state, and preview failure are handled separately; migration 016 protects referenced media. |
| R06 | Fixed in automated coverage | Migration 017 enforces expected photo versions. The stale tab reloads and displays the winning replacement, explains the rejected attempt, and deletes only its own unreferenced upload; the two-tab browser regression passes. Real concurrent PostgreSQL sessions remain outstanding. |
| R07 | Fixed | Migration 016 repairs selfie attribution so team ownership survives a participant move. |
| R08 | Fixed | Migration 016 makes review-gallery lifecycle checks null-safe and explicitly reports review availability. |
| R09 | Fixed | Migration 016 denies ordinary Storage cleanup for referenced submission and selfie paths. |
| R10 | Fixed | Commit `5f6802e` makes organizer/play switching membership-aware and synchronizes direct hunt routes. |
| R11 | Fixed | Migration 018 stores encrypted recoverable links with a Vault-held key; migration 022 suppresses closed-hunt links. Legacy unrecoverable links require deliberate replacement. |
| R12 | Fixed | Migration 019 enables team/selfie realtime; organizer lobby refreshes from realtime and a 15-second fallback, with explicit preview error state. |
| R13 | Fixed in automated coverage | Participant and organizer review galleries reconcile every 20 seconds and on foreground/online; signed URLs are cached and renewed before expiry. A failed/expired preview can be retried per photo in both galleries. iOS/Safari and Android background/restore behavior remains unobserved. |
| R14 | Fixed | Positive first-place ties share the win, zero-score hunts have no winner, card names fit measured width, preview URLs are released, and winning participants can share/download a card. |
| R15 | Fixed in code with migration compatibility | Chat has reconnect state, foreground/poll recovery, older-message paging, jump-to-latest behavior, closed-hunt read-only mode, and an eight-message-per-minute server limit. The client falls back to the existing timestamp RPC when the four-argument cursor RPC is absent. Production currently has only the legacy overload; exact tie-safe paging awaits isolated validation and migration 024. |
| R16 | Fixed | Production organizers can reopen/edit saved drafts; migration 021 enforces owner and draft status. Scheduled start changes and active-hunt time extensions are exposed in the workspace. |
| R17 | Fixed in automated coverage | Participant, gallery, and lobby responses use request generations; stable media paths reuse signed URLs; static challenge rows are not reloaded on each active-game timer refresh, while submissions continue to refresh. The current browser test verifies this request pattern. Production load impact remains unmeasured. |
| R18 | Fixed in code; hosted acceptance pending | Client operation IDs record privacy-safe photo, selfie, chat, review, finalization, and organizer timing failures through the owner-scoped audit log. Organizer actions carry the organizer app label; legacy `client_operation` rows are identified as client-reported when the source column is absent. The Troubleshooting log no longer promises a 365-day expiry while the separately gated retention migration is unapplied. Desktop/mobile regressions cover source display and failure traces. Commit `3169936`, Actions run `42334532643`, and the served manifest verify the release. Live end-to-end trace walkthroughs and retention approval/testing remain under IMP-14/22. |
| R19 | Fixed in code | Waiting copy is rendered in JSX; active-player chat follows the challenge list; quick team links now sit directly below QR codes; key phone controls have larger touch targets and focus styling. Physical-device visual/accessibility acceptance was unavailable here. |
| R20 | Fixed | Phase 0 separates PR validation from serialized Pages publishing and verifies the served commit in the deploy smoke step. |

## Limits of verification

The automated suite exercises the migration contracts and app logic, but this environment has no connected mobile browser session. The requested 320/375/390 px, 200% zoom, screen-reader, iOS native-share, and two-physical-device walkthroughs have not been directly observed. Treat R19 as implemented pending that visual/accessibility walkthrough. Storage HTTP failure injection and simultaneous PostgreSQL review/finalization races also require a dedicated hosted test hunt; no destructive probes were run against real hunts.
