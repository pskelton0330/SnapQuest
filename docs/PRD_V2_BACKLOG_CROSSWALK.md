# PRD v2 to remediation backlog crosswalk

Updated November 7, 2026. This index maps all 56 requirements in the [PRD v2 checklist](PRD_V2_CHECKLIST.md) to the current deep-review backlog, verification gate, or deferred product decision. A mapping is traceability only; it does not change the requirement status or imply acceptance.

Status evidence is maintained in the [checklist](PRD_V2_CHECKLIST.md), [improvement backlog](reviews/2026-11-06-improvement-backlog.md), [remediation status](reviews/2026-11-06-remediation-status.md), and [test evidence](PRD_V2_TEST_EVIDENCE.md). The backlog addresses the 20 findings from the review. PRD v2 contains additional scope, especially hunt discovery, completed-play tracking, quick review, montage/video, media lifecycle, and permanent account flows; those are tracked below as product-scope work, not as completed review fixes.

| PRD requirement | Related remediation or decision | Coverage and next action |
| --- | --- | --- |
| HUNT-01 | Roadmap; PRD scope | Production template discovery is outside R01â€“R20. Decide whether it belongs in core launch, then plan production browsing and acceptance. |
| HUNT-02 | IMP-16; PRD scope | Editor parity is addressed. Server-side template drafts and library parity remain separate product work. |
| HUNT-03 | IMP-15; PRD scope | Public/private access boundaries are locally tested; production discovery and live authorization acceptance remain. |
| HUNT-04 | PRD scope | No completed-play ledger exists. Design the authoritative event/count model before implementing popularity. |
| HUNT-05 | IMP-15 | Public-template/private-game separation has local database coverage; include it in the hosted role-boundary matrix. |
| AUTH-01 | IMP-05, IMP-12, IMP-15 | Owner checks are implemented; self-onboarding and permanent-account release need product design and hosted auth testing. |
| AUTH-02 | IMP-05, IMP-11, IMP-15 | Join identity and team assignment have local tests; verify live Auth/JWT behavior and multi-device resume. |
| AUTH-03 | IMP-11, IMP-12, IMP-15 | Resume and organizer/player switching are browser-tested; verify live identity restoration, recovery, and role boundaries. |
| JOIN-01 | IMP-11, IMP-17 | Team QR/copy links exist; verify paging, rotation, second-device entry, and closed-hunt behavior. |
| JOIN-02 | IMP-09, IMP-11, IMP-15 | Join uniqueness and team assignment have local coverage; hosted and multi-device acceptance remain. |
| JOIN-03 | IMP-09, IMP-11, IMP-15 | Existing-member resume has local coverage; hosted and multi-device acceptance remain. |
| TEAM-01 | IMP-05, IMP-09, IMP-15, IMP-22 | Names and selfies are implemented; verify cross-device synchronization, Storage policy, cutoff/opt-out wording, and lifecycle decisions. |
| SESSION-01 | IMP-02, IMP-11, IMP-12 | Browser reload/history coverage exists; physical-device, cleared-storage, and multi-device acceptance remain. |
| SESSION-02 | IMP-05, IMP-11, IMP-15 | Local rotation/closeout tests exist; verify live Auth/JWT and concurrent behavior. |
| SESSION-03 | IMP-02, IMP-10, IMP-11, IMP-12, IMP-18 | Foreground/online recovery has browser coverage; verify native background, token refresh, and realtime recovery. |
| UX-01 | IMP-16, IMP-17 | Editor and organizer workflows are improved; remaining editor parity and phone workflow evidence are listed under those items. |
| TIME-01 | IMP-07, IMP-17 | Setup-without-timer behavior is locally covered; verify remote UI and server state. |
| TIME-02 | IMP-07, IMP-17 | Start Now is live-smoke tested; verify reschedule and duplicate-start behavior in the isolated hosted environment. |
| TIME-03 | IMP-07, IMP-14, IMP-17 | Lifecycle and audit behavior have local/live evidence; verify connected-device updates and full timing matrix. |
| PLAY-01 | IMP-02, IMP-03, IMP-07, IMP-10, IMP-17 | Timer, progress, and gameplay routes have browser coverage; physical timing, reconnect, and submitter-name acceptance remain. |
| PROGRESS-01 | IMP-05, IMP-09, IMP-15 | Progress aggregate is implemented; verify access boundaries and selfie policy on hosted backend. |
| PHOTO-01 | IMP-02, IMP-04, IMP-19 | Browser image flows are covered; verify orientation and HEIC/representative device formats. |
| PHOTO-02 | IMP-04, IMP-05, IMP-06, IMP-14, IMP-15 | Client reconciliation and fault handling are tested; actual Storage HTTP and concurrent sessions remain. |
| PHOTO-03 | IMP-04, IMP-05, IMP-06, IMP-14 | Version checks and cleanup retry are covered locally; verify real races and durable cleanup behavior. |
| PHOTO-04 | IMP-04, IMP-05, IMP-06, IMP-10 | Browser denial, uncertainty, cleanup, and preview retry are covered; hosted Storage and device-format checks remain. |
| SCORE-01 | IMP-06, IMP-08 | SQL and application results agree in PGlite; hosted scoring and concurrency checks remain. |
| REVIEW-01 | IMP-01, IMP-06, IMP-08; product decision | Reversible decisions before finalization are fixed. The PRD quick-review policy conflicts with existing manual review behavior and needs an explicit product decision before implementation. |
| SCORE-02 | IMP-08; product decision | Existing optional voting is retained. Best-photo scoring is an open rule; decide before adding or changing scoring behavior. |
| REVIEW-02 | IMP-01, IMP-08, IMP-17 | Decision correction and gallery basics are covered; selected-item paging and attribution remain a usability scope decision. |
| FINAL-01 | IMP-06, IMP-08, IMP-14; product scope | Stored results and retry behavior are covered; completed-play ledger and render-job uniqueness are not implemented and depend on future output work. |
| POST-01 | IMP-11, IMP-22 | Existing-member closeout behavior is locally tested; guest results window and retention need policy decisions. |
| POST-02 | IMP-19; roadmap | Browser celebration card is the current core output. A real montage lifecycle is deferred premium work. |
| POST-03 | IMP-19; roadmap | Browser celebration card exists. Real montage preview/export is deferred premium work. |
| POST-04 | IMP-15, IMP-19, IMP-22; roadmap | Private media boundaries and user-triggered share/download are covered in code; video export disclosure and lifecycle are deferred. |
| POST-05 | IMP-22; owner decision | Retention fields and deletion workflow require approved durations, provider backup behavior, and a coordinated implementation plan. |
| VIDEO-01 | IMP-24; roadmap | Deferred. Requires renderer, cost, rights, retention, deletion, and failure-recovery design. |
| VIDEO-02 | IMP-24; roadmap | Deferred. Define renderer branding configuration if video is approved. |
| VIDEO-03 | IMP-24; roadmap | Deferred. Requires a real export pipeline and output acceptance criteria. |
| VIDEO-04 | IMP-24; roadmap | Deferred. Requires safe, reliable download/share and lifecycle behavior. |
| MUSIC-01 | IMP-24; roadmap | Deferred pending licensed catalog and attribution requirements. |
| MUSIC-02 | IMP-24; roadmap | Deferred pending rights, opt-out, and export behavior design. |
| MUSIC-03 | IMP-24; roadmap | Deferred pending catalog controls and validation. |
| MEDIA-01 | IMP-22, IMP-24; roadmap | Deferred with montage lifecycle; define private access and deletion before implementation. |
| MEDIA-02 | IMP-22, IMP-24; roadmap | Deferred; requires authorized media selection and rights/consent policy. |
| MEDIA-03 | IMP-22, IMP-24; roadmap | Deferred; requires output expiry, deletion, and retry semantics. |
| MEDIA-04 | IMP-08, IMP-22 | Stored score snapshot is independent of image bytes; verify a coordinated deletion workflow preserves results. |
| SEC-01 | IMP-05, IMP-15 | Local ownership boundaries pass; full live role matrix remains. |
| SEC-02 | IMP-05, IMP-09, IMP-15 | Private buckets and signed URLs are implemented; verify actual Storage HTTP, deletion denial, and revocation. |
| SEC-03 | IMP-14, IMP-15, IMP-24 | SQL validation exists; public abuse controls and expensive-output rate limits need a threat/cost design. |
| SEC-04 | IMP-05, IMP-15 | Local role-boundary checks pass; confirm live permissions and progress-data exposure. |
| PRIV-01 | IMP-03, IMP-15, IMP-22 | Data inventory exists; owner decisions, deletion controls, device checks, and assistive-technology review remain. |
| A11Y-01 | IMP-03, IMP-19 | Automated scans cover tested routes; keyboard navigation and 200% text-size browser checks now cover home, participant lobby/play/review/results, and organizer lobby/review/results. Physical screen-reader and device acceptance remain. |
| MIG-01 | IMP-21 | PRD v2 was reviewed; requirement traceability is now indexed here. |
| MIG-02 | IMP-05, IMP-13, IMP-14, IMP-22 | Production history is verified through migration 022; 023/024 need isolated acceptance and 025 additionally needs explicit retention approval. |
| MIG-03 | IMP-05, IMP-06, IMP-13, IMP-15 | Migration source and local coverage exist; legacy-data mapping, forward repair, rollback, and hosted acceptance remain. |
| MIG-04 | IMP-05, IMP-13, IMP-14, IMP-22 | Additive migrations are locally repeatable; hosted acceptance is required, and 025 remains owner-gated. |
| MIG-05 | IMP-05, IMP-06, IMP-15 | Live migration history is read-only verified through 022; hosted authorization, Storage, and concurrency tests remain. |

## Release interpretation

- **Review backlog completion** means each IMP item has implementation or a documented resolution, evidence at the required level, a published commit, and a verified deployed revision where applicable.
- **PRD v2 completion** is broader. Rows marked product scope, roadmap, deferred, or owner decision are not silently considered done when the review backlog closes.
- **Automated coverage** does not satisfy physical-device, screen-reader, real email, hosted Storage HTTP, live authorization, or multi-session PostgreSQL gates.
