# UI and reliability implementation tracker

Owner-approved plan: improve trust in live progress, organizer management and play, entry and gameplay, review and results, chat, data lifecycle, and accessibility. Work in tested batches, push to GitHub, and verify deployment. Do not add paid services or hosted test branches. Use the ephemeral Supabase CI stack and synthetic data.

- [x] Establish baseline: local and GitHub main and live manifest matched `34e8f69`; Pages run [42410210949](https://github.com/pskelton0330/SnapQuest/actions/runs/42410210949) and Supabase run [42410211042](https://github.com/pskelton0330/SnapQuest/actions/runs/42410211042) passed. Correct conflicting retention and physical-device notes.
- [x] Live progress: retain last known counts, show stale/initial failure, recover on reconnect, and prevent older responses from overwriting newer ones in browser regressions.
- [x] Organizer dashboard: show hunt stage, next action, readiness, and navigation to invitations, chat, controls, and troubleshooting; automated browser acceptance passed.
- [x] Organizer play/manage switch: identify the active mode, preserve membership and return to the current hunt; automated browser acceptance passed.
- [x] Home and entry: reduce hero height, improve readability, and clarify join and login recovery; automated browser acceptance passed.
- [x] Gameplay: clarify upload, submission, preview, and retry states; automated browser acceptance passed.
- [x] Review and results: review counts and filters, finalization guidance, authoritative scores, and celebration layout; automated browser acceptance passed.
- [x] Chat: connection feedback, paging during refresh, unread counts, and recovery; automated browser acceptance passed.
- [ ] Privacy: deletion and durable cleanup are designed but cannot be implemented or activated until the owner decides the effect on results and shared participant data, retention rules, and worker cost. No production deletion was performed.
- [x] Automated accessibility, performance, browser regression, and deployment checks passed for `3b5afbe`; see limitations below. The following polling change is subject to a fresh deployment workflow.
- [x] Keep video, music, direct posting, and AI generation on the future roadmap with cost gates.

Audit events must be retained beyond 365 days; no maximum has been specified. Hands-on iOS testing is waived and remains unperformed; WebKit emulation is not physical-device evidence. Android acceptance has not been waived by this decision. Never run destructive tests on production.

## Implementation notes

- Progress freshness is live in `925d0bb`: stale counts are retained and labeled, initial failures do not appear as zero, and reconnect refreshes them. [Pages workflow](https://github.com/pskelton0330/SnapQuest/actions/runs/42412752990) and [Supabase workflow](https://github.com/pskelton0330/SnapQuest/actions/runs/42412752934) passed. A later browser regression verifies that an older response cannot overwrite newer counts.
- Commit `0c0cb7c` adds a hunt status and roster summary, moves the waiting-lobby end action behind More hunt controls, clarifies home entry, adds photo-review counts and filters, places final standings earlier, and keeps an older chat page when a refresh completes while it is loading. [Pages](https://github.com/pskelton0330/SnapQuest/actions/runs/42413294313) and [Supabase](https://github.com/pskelton0330/SnapQuest/actions/runs/42413294335) passed and the live manifest matched. Full lifecycle/dashboard and play/manage acceptance remain open.
- [Hunt deletion design](../HUNT_DELETION_DESIGN.md) records a proposed durable deletion process and the owner decisions needed before activation. No production deletion is authorized by this document.
- Commit `1b0eb26` adds a lifecycle indicator and a direct review action, returns organizers to the current hunt's team when switching modes, makes the home action for review open the actual review screen, pauses background context polling, and places the celebration card before the gallery. Commit `3b5afbe` syncs the indicator with server runtime, adds retry for failed status refreshes, and groups navigation to chat, invitations, and diagnostics. [Pages](https://github.com/pskelton0330/SnapQuest/actions/runs/42414782835) and [Supabase](https://github.com/pskelton0330/SnapQuest/actions/runs/42414782812) passed and the live manifest matched `3b5afbe`.
- Organizer status refresh failures show an out-of-date warning and a retry action. Synthetic browser tests cover the failure and recovery path; this is not a live hosted outage test. Hands-on iOS testing remains waived, not passed; Android and assistive-technology observation remain unverified.
