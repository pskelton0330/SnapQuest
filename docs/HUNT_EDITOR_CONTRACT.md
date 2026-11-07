# Hunt editor parity contract

Updated: November 7, 2026

## Decision

The authenticated production editor and the browser-local preview editor share hunt-domain rules and challenge-list behavior. Their persistence, access, and publish flows intentionally remain separate because they serve different purposes: production drafts belong to an authenticated organizer and are stored in Supabase; preview hunts are sample/local data stored in the current browser and are not production hunts.

Do not copy preview persistence into the production path or imply that a local preview save is a durable account save. Do not expose production hunts through the local preview repository.

## Shared behavior

| Contract | Shared implementation | Evidence |
| --- | --- | --- |
| Hunt title, venue, description, duration, rules, challenge count, challenge title/description, and point bounds | `validateHuntDraft` in `src/lib/huntEditor.ts`; production maps its draft to the domain shape before calling it | `tests/hunt-editor.test.mjs`; production create/edit browser flow |
| Add, remove, edit, and reorder challenge rows | `ChallengeListEditor` in `src/components/ChallengeListEditor.tsx` | Production and reusable editor browser coverage |
| Pasted challenge parsing, optional list-marker stripping, and 100-item cap | `importChallenges` in `src/lib/huntEditor.ts` | `tests/hunt-editor.test.mjs`; production editor import browser flow |
| Suggested safety rules | `SUGGESTED_RULES` in `src/lib/huntEditor.ts` | Imported by both editor paths |

## Deliberate differences

| Concern | Authenticated production editor | Local preview editor |
| --- | --- | --- |
| Persistence | `create_hunt_draft` / `update_hunt_draft` RPCs, guarded by organizer ownership and draft status | Local workspace repository; unfinished form state uses browser storage |
| Reusable library | Authenticated organizer library rows can be added while preserving `library_item_id` | Local preview sample/library data only |
| Publishing | `publish_hunt` creates teams, invites, and scheduled/manual hunt state | Creates an isolated preview game from a reusable local template |
| Recovery | Saved drafts can be reopened from the organizer hunt list; unsaved production form values are not a cloud-saved draft | Browser-local autosave is device/browser scoped and is labeled preview-only |

These differences are intentional. A production draft becomes durable when the organizer selects **Save draft**. The UI must not describe unsaved production edits as automatically saved. Future autosave work would need an authenticated draft record and the same ownership/status checks, not a local-storage-only implementation.

## Acceptance evidence

- Browser test `organizer can save, reopen, edit, and save a production draft` verifies production create/save/reopen/edit/reorder/save through the authenticated workspace and mocked Supabase RPC contract.
- `organizer hunt editor fits phone widths, passes axe, and reorders challenges` checks the production editor at 320, 375, and 390 CSS pixels, axe, import parsing, and reorder behavior.
- Shared validation/import/domain helpers have unit coverage; PGlite migration tests cover owner/draft restrictions on production edit/publish RPCs.
- These tests do not establish live Supabase policy behavior; hosted role-boundary acceptance remains tracked by IMP-05/15.
