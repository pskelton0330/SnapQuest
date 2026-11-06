# SnapQuest deep review remediation status

Updated: November 6, 2026
Source: [deep review](2026-11-06-deep-review.md) and [remediation plan](2026-11-06-remediation-plan.md)

## Release evidence

- `npm.cmd test`: 67 passed, 0 failed.
- `npm.cmd run lint`: passed without warnings.
- `npm.cmd run build`: passed. Vite still reports the existing large JavaScript chunk warning (about 600 KB minified, 170 KB gzip); it does not fail the build.
- Supabase production migrations 001–022 are applied to project `ykfkwczcomkhxaraqpuq`.
- Phase 0 and all remediation commits are live on [GitHub Pages](https://pskelton0330.github.io/SnapQuest/). [GitHub Actions run 44](https://github.com/pskelton0330/SnapQuest/actions/runs/42284163294) passed build, deploy, and the live home/version smoke check. The served manifest reports `63398f8ce962240c7695e2fff968b15b694e417b`.

## Finding ledger

| Finding | Status | Implementation / evidence |
| --- | --- | --- |
| R01 | Fixed | Anonymous participants can reach public home without losing their participant identity; guest and organizer route tests pass. |
| R02 | Fixed | Natural expiry exposes the explicit server-authoritative Start photo review action; migration 016 and lifecycle tests cover the transition. |
| R03 | Fixed | Completed views use stored final scores; vote payload normalization and dense ranks are tested. |
| R04 | Fixed | Migration 016 locks and guards review/finalization; completed retries return the stored snapshot. |
| R05 | Fixed | Upload, acceptance, uncertain state, and preview failure are handled separately; migration 016 protects referenced media. |
| R06 | Fixed | Migration 017 enforces expected photo versions; the client reconciles the exact attempted object and preserves uncertain uploads. |
| R07 | Fixed | Migration 016 repairs selfie attribution so team ownership survives a participant move. |
| R08 | Fixed | Migration 016 makes review-gallery lifecycle checks null-safe and explicitly reports review availability. |
| R09 | Fixed | Migration 016 denies ordinary Storage cleanup for referenced submission and selfie paths. |
| R10 | Fixed | Commit `5f6802e` makes organizer/play switching membership-aware and synchronizes direct hunt routes. |
| R11 | Fixed | Migration 018 stores encrypted recoverable links with a Vault-held key; migration 022 suppresses closed-hunt links. Legacy unrecoverable links require deliberate replacement. |
| R12 | Fixed | Migration 019 enables team/selfie realtime; organizer lobby refreshes from realtime and a 15-second fallback, with explicit preview error state. |
| R13 | Fixed | Participant and organizer review galleries reconcile every 20 seconds and on foreground/online; signed URLs are cached and renewed before expiry. |
| R14 | Fixed | Positive first-place ties share the win, zero-score hunts have no winner, card names fit measured width, preview URLs are released, and winning participants can share/download a card. |
| R15 | Fixed | Chat has reconnect state, foreground/poll recovery, older-message paging, jump-to-latest behavior, closed-hunt read-only mode, and an eight-message-per-minute server limit. Migration 020 adds cursor-based history. |
| R16 | Fixed | Production organizers can reopen/edit saved drafts; migration 021 enforces owner and draft status. Scheduled start changes and active-hunt time extensions are exposed in the workspace. |
| R17 | Fixed | Participant, gallery, and lobby responses use request generations; stable media paths reuse signed URLs; polling and error states are scoped to their operation. |
| R18 | Fixed | Client operation IDs record privacy-safe photo, selfie, chat, review, and finalization stages through the existing owner-scoped audit log; a Troubleshooting log is available in hunt management. Client reports are labeled and contain no media paths, signed URLs, tokens, or message text. |
| R19 | Fixed in code | Waiting copy is rendered in JSX; active-player chat follows the challenge list; quick team links now sit directly below QR codes; key phone controls have larger touch targets and focus styling. Physical-device visual/accessibility acceptance was unavailable here. |
| R20 | Fixed | Phase 0 separates PR validation from serialized Pages publishing and verifies the served commit in the deploy smoke step. |

## Limits of verification

The automated suite exercises the migration contracts and app logic, but this environment has no connected mobile browser session. The requested 320/375/390 px, 200% zoom, screen-reader, iOS native-share, and two-physical-device walkthroughs have not been directly observed. Treat R19 as implemented pending that visual/accessibility walkthrough. Storage HTTP failure injection and simultaneous PostgreSQL review/finalization races also require a dedicated hosted test hunt; no destructive probes were run against real hunts.
