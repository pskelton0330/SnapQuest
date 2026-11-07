# Hunt deletion design (not implemented)

This design is for future owner review. It does not delete production data or establish a retention period. Audit events must be kept beyond 365 days; no maximum has been approved. See [privacy and lifecycle](PRIVACY_LIFECYCLE_POLICY.md) for the data inventory and unresolved policy questions.

## User experience

An organizer opens hunt settings and selects Delete hunt. A confirmation describes the specific data and access that will be removed and warns that the operation is permanent. Show the hunt name and require deliberate confirmation. Show deletion as pending until all authorized cleanup has completed; a failure must offer a retry without suggesting that all data was removed. The exact effect on scores, history, shared participant data, and audit records requires owner policy decisions before activation.

## Proposed operation

1. An authenticated permanent organizer requests deletion through a server-authorized operation. Verify ownership on every request. Store a durable deletion job keyed to the hunt and make retries idempotent.
2. Once approved policy permits it, stop new invitations, uploads, and ordinary reads for the hunt. Snapshot the object identifiers to be removed in a protected job record before references are changed. Avoid exposing storage paths or invite secrets in user-facing output or diagnostic details.
3. A trusted worker removes only objects belonging to that hunt after checking references and authorization. Record each object's progress durably; retry transient failures without deleting objects referenced by other records. Do not rely on a participant's browser remaining open.
4. Delete or anonymize related database records in the order required by foreign keys and the approved policy. Keep the final-score snapshot or remove it only according to that policy. Protect diagnostic records for the owner-approved period.
5. Mark completion only after the database and private Storage work are verified. If a step fails, retain enough protected state for safe retries and report a sanitized failure to the organizer.

The worker's hosting, schedule, and cost must be chosen before implementation. During development use the existing ephemeral Supabase stack and synthetic objects; do not provision a paid service.

## Acceptance requirements

- Owner can request deletion only for their own hunt; participants and other organizers are denied.
- A second request or retry cannot duplicate destructive work or remove unrelated objects.
- Interrupted Storage deletion remains pending, can be retried, and never claims success early.
- Concurrent uploads and reads are handled consistently after deletion begins.
- Shared references and another hunt's objects remain intact.
- Logs do not contain photo contents, signed URLs, object paths, or invitation tokens.
- User-facing claims accurately distinguish application data from provider backups and logs.
- Tests use synthetic users, hunts, and objects. No production deletion occurs as a test.

## Decisions needed before activation

- Whether results and history are removed or anonymized when the hunt is deleted.
- Photo, selfie, chat, results, and invitation retention durations and starting events.
- Participant controls over shared photos and team data.
- Provider backup, restoration, and log retention behavior, verified against the selected service plan.
- A durable worker design and its expected cost.
