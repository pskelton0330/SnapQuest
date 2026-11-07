# SnapQuest privacy and data lifecycle policy proposal

**Status:** Working proposal for product-owner review. This file records current behavior and the decisions required before making retention or deletion promises. It is not a legal privacy notice and does not authorize production data deletion.

## Current data and access map

| Data | Current use and access | Current lifecycle evidence |
| --- | --- | --- |
| Organizer email and Supabase identity | Email magic-link authentication; organizer profile and hunt ownership are checked server-side. | No self-service account deletion flow is implemented. Supabase Auth project-level retention and backup behavior have not been audited here. |
| Participant display name, identity, team, and hunt membership | Anonymous Auth identity joins a team and resumes the same participant session. Team members and organizers see roster details according to the app/database rules. | No product-level participant deletion or identity export flow is implemented. Clearing browser storage loses a guest's local session; the app cannot restore it by name alone. |
| Invitation secrets | QR/join tokens are hashed for validation; organizer recovery links are stored encrypted under a Vault-held key. | Invite rotation invalidates old links. No scheduled expiration or user-facing secret-erasure schedule is configured. |
| Team selfies | One current private image per team; team members can replace it before the cutoff. Short-lived signed URLs are used for previews. | Replacement cleanup exists, with a local retry queue for failed deletes. There is no hunt-wide or user-triggered selfie deletion workflow. |
| Challenge photos | Private Storage; accepted submissions are tied to team/challenge slots. Participants may replace a slot under server-enforced timing/version rules; organizers review and score. | Failed unreferenced uploads can be cleaned up and retry failures are queued locally. Referenced media is protected from ordinary cleanup. There is no coordinated user-requested or scheduled deletion process. |
| Votes, review decisions, and finalized scores | Stored in Postgres; final results use an immutable server-side score snapshot. | Finalized results remain available to existing members. No approved duration, removal request workflow, or retention field is configured. |
| Hunt chat | Hunt members can read and send while the hunt is open; closed hunts are read-only. Message content is not included in diagnostic events. | No chat-specific deletion or retention schedule is configured. Migration `202611060024` is not yet applied to production as of the November 6, 2026 read-only audit. |
| Diagnostic events | Operation/stage/outcome metadata; client reports use an allowlist and omit photo bytes, invitation tokens, signed URLs, and chat bodies. | Migration `202611060023` hardens client event validation without deletion. Separate migration `202611070025` proposes pruning events older than 365 days on log reads/writes. It is not applied to production and requires explicit operator authorization. No 365-day production promise should be made yet. |

## Proposed product rules

1. Keep media private and use short-lived signed URLs. Do not include private object paths or signed URLs in public links, captions, or diagnostics.
2. Keep finalized score snapshots independent from photo bytes. A future media deletion must not erase scores, ranks, or completed-hunt history unless the owner separately requests hunt/account deletion under an approved policy.
3. Make deletion a coordinated server operation: authorize the requester, prevent new reads, remove dependent references and Storage objects, retry partial failures durably, and record a privacy-safe completion result. Ordinary upload cleanup must continue refusing referenced objects.
4. Clearly distinguish current replacement cleanup from deletion of a whole hunt or participant account. The current app does not provide the latter workflows.
5. Define retention per data class and state the event that starts each clock (hunt end, finalization, account closure, or last activity). Until an owner approves durations and implementation, show no expiry date and schedule no production deletion.
6. Treat backups and provider logs separately from primary database/Storage deletion. Their retention and restore behavior must be checked with the provider before promising complete erasure.

## Decisions required before implementation

- How long should team selfies and challenge photos remain after hunt completion? Should an organizer be able to delete them earlier?
- How long should finalized results and chat remain available to members? Should closing an account remove results, anonymize names, or preserve event history?
- What deletion controls should organizers and participants have, and what proof/confirmation is required before removing shared hunt data?
- What are the actual Supabase backup, Auth, and Storage deletion/restore periods for the selected plan and configuration?
- Should diagnostic-event expiry remain 365 days? Approve migration 025 only after reviewing its exact affected-row scope and test-project behavior.
- Should invitation recovery secrets expire automatically after hunt completion, and when should encrypted values be removed?

## Release gate

Before publishing retention or deletion claims, approve these decisions, implement and test the relevant database and Storage workflows in an isolated Supabase project, document partial-failure recovery, then update the user-facing privacy notice. Do not apply migration 025 or perform bulk deletion as part of this proposal.
