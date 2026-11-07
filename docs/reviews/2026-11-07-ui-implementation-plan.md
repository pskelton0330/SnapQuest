# UI and reliability implementation tracker

Owner-approved plan: improve trust in live progress, organizer management and play, entry and gameplay, review and results, chat, data lifecycle, and accessibility. Work in tested batches, push to GitHub, and verify deployment. Do not add paid services or hosted test branches. Use the ephemeral Supabase CI stack and synthetic data.

- [x] Establish baseline: local and GitHub main and live manifest matched `34e8f69`; Pages run [42410210949](https://github.com/pskelton0330/SnapQuest/actions/runs/42410210949) and Supabase run [42410211042](https://github.com/pskelton0330/SnapQuest/actions/runs/42410211042) passed. Correct conflicting retention and physical-device notes.
- [ ] Live progress: retain last known counts, show stale/initial failure, recover on reconnect, and prevent older responses from overwriting newer ones.
- [ ] Organizer dashboard: show hunt stage, next action, readiness, and clear groups for invitations, chat, controls, and troubleshooting.
- [ ] Organizer play/manage switch: identify the active mode, preserve membership and return location.
- [ ] Home and entry: reduce hero height, improve readability, and clarify join and login recovery.
- [ ] Gameplay: clarify upload, submission, preview, and retry states.
- [ ] Review and results: review counts and filters, finalization guidance, authoritative scores, and celebration layout.
- [ ] Chat: connection feedback, paging during refresh, unread counts, and recovery.
- [ ] Privacy: inventory data, design deletion and durable cleanup, test using synthetic data, and record unresolved policy decisions before deleting production data.
- [ ] Accessibility, performance, final regression, and deployment evidence.
- [ ] Keep video, music, direct posting, and AI generation on the future roadmap with cost gates.

Audit events must be retained beyond 365 days; no maximum has been specified. Hands-on iOS testing is waived and remains unperformed; WebKit emulation is not physical-device evidence. Android acceptance has not been waived by this decision. Never run destructive tests on production.

## Implementation notes

- Progress freshness is live in `925d0bb`: stale counts are retained and labeled, initial failures do not appear as zero, and reconnect refreshes them. [Pages workflow](https://github.com/pskelton0330/SnapQuest/actions/runs/42412752990) and [Supabase workflow](https://github.com/pskelton0330/SnapQuest/actions/runs/42412752934) passed. An out-of-order response regression remains to be added.
- The current batch adds a hunt status and roster summary, moves the waiting-lobby end action behind More hunt controls, clarifies home entry, adds photo-review counts and filters, places final standings earlier, and keeps an older chat page when a refresh completes while it is loading. Full lifecycle/dashboard and play/manage acceptance remain open.
- [Hunt deletion design](../HUNT_DELETION_DESIGN.md) records a proposed durable deletion process and the owner decisions needed before activation. No production deletion is authorized by this document.
