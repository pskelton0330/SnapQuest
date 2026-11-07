# SnapQuest implementation review

Assessment date: 2026-11-01. Scope: repository files, historical PRD v1.1, supplied v1.2 instructions, latest existing-app improvement request, and local checks. No live Supabase schema or dashboard was inspected. Latest supplied instructions govern this incremental batch.

> **Historical snapshot:** This assessment predates the subsequent production and reliability releases and must not be used as the current status ledger. Check the [PRD v2 checklist](docs/PRD_V2_CHECKLIST.md), [test evidence](docs/PRD_V2_TEST_EVIDENCE.md), and [improvement backlog](docs/reviews/2026-11-06-improvement-backlog.md) for verified current behavior and remaining gaps.

## Current state and gaps

| Capability | Evidence and status |
| --- | --- |
| Reusable hunts and separate games | Implemented and locally verified in workspace.ts, adapter tests and migration 007. Independent challenge/rule snapshots survive template edits in local and PGlite tests. Supabase adapter is not connected to the preview. |
| Public discovery | Local browse/search/filters implemented; public safe-document RPC and access boundaries tested in PGlite. Live public discovery remains unverified. |
| Personal copies | Implemented and tested as independent, personal templates. No automatic public publishing of copies. |
| Organizer navigation | Browse Hunts, My Hunts, My Games, Create a Hunt implemented in preview. Older authenticated OrganizerWorkspace still has its legacy navigation and builder. This pass improves the established preview without introducing another builder. |
| Builder | Existing guided editor supports edits, order, instructions, points, library reuse, bulk import and browser cache recovery. No separate unpublished saved-template status in shared model/migration 007. Legacy draft game rows remain private. |
| Timing | Local controls/domain tests and staged migration 008 cover setup, immediate start, reschedule, extensions and early end. Authorization and cutoff tests run in PGlite. Actual Supabase Realtime delivery is unverified. No timing-change audit record exists. |
| Aggregate live team progress | Missing. Existing participant screen shows own-team submission count, not opponent aggregate progress. No new progress feature added in this batch. |
| Photos | Private Storage policies, authenticated attribution, unique team/item submission and server deadline checks exist. SQL tests exercise basic acceptance/replacement and cutoff. UI collapses preparation/upload/acceptance into one busy state; explicit retry with retained selection is missing. |
| Replacement safety | A failed SQL submission leaves the accepted row intact; client attempts temporary cleanup. Game/submission locks serialize changes, but no expected-version check prevents a stale teammate screen replacing a newer accepted photo. True simultaneous multi-connection races and Storage failure recovery are unverified. Cleanup failures lack a durable retry path. |
| Voting/scoring | SQL enforces one effective team vote/item and no self-vote; base scores use approved submissions, bonus counts join eligible approved photos. Zero-vote/approval cases have display unit tests; comprehensive voting/finalization database edge-case coverage is still missing. |
| Review | Existing grid has challenge headings, per-team placeholders, approval/rejection and links to enlarge. No selected-challenge paging, submitter names, or large-team comparison paging. UI offers decisions only for pending photos although review RPC permits decision changes. Presentation improvements are deferred. |

## Preserved features

React/TypeScript/Vite and the Supabase architecture; existing data and snapshots; organizer profile authorization; anonymous participant identities; individual/shared QR modes; balanced assignment; multiple phones per team; waiting rooms and server cutoff rules; one active team/challenge photo; private storage; submitting-participant attribution; review, team voting and authoritative finalization. No authentication replacement or policy relaxation was made.

## Small first batch delivered

- Clear Create Game action before configuration; confirmed Start Now stays inside game management.
- Current lifecycle and contextual guidance; shortcuts keep timing, team rosters and invitations together without changing hash routes.
- Explicit publishing/personal-save labels, public-content notice and browser-only unfinished-draft explanation.
- Preserve pasted wording by default; optional marker removal and existing review/edit step.

No lifecycle rules, database model, migrations, scoring, photo handling or reveal permissions were changed. Existing immediate and scheduled setup choices remain available within the game.

## Conflicts and boundaries for the next batch

1. PRD v1.1 records migrations 001–006 as applied, while an older README claimed only 001–002. README now distinguishes historical documentation from remote verification. Audit live schema before applying staged 007–008; do not infer deployment from local tests.
2. Templates have public/personal visibility, not draft/publication status. The browser cache is unfinished work, not a saved unpublished template. Proper server drafts require a proposed additive schema/API change and review before implementation.
3. SQL finalization uses dense_rank (1,1,2), as specified in v1.1; the display helper uses competition ranking (1,1,3), and organizer results recompute scores instead of displaying stored final_scores. Preserve approved dense ranking when proposing the correctness fix; no scoring change made here.
4. Repeated finalization currently rejects a completed game rather than returning its existing result. It cannot re-award through that RPC, but completed-template-play accounting is not implemented. Do not claim complete idempotency/popularity coverage.
5. Approval changes are supported in SQL during review, and final bonus calculation excludes rejected photos; UI decision changes and concurrency/eligibility tests still need work. No voting rule was changed.
6. Two-team voting gives each team only one opposing choice. Add a configuration explanation in the next correctness batch; no new voting system is proposed.
7. Public template wording is discoverable. Game pre-start item access remains separate and cannot make the public source wording secret.
8. The newer preview and real authenticated workspace are not yet unified. Local polish does not prove real phone participation, uploads or synchronization.

## Verification for this batch

- Automated: 39 tests passed, including existing authorization/snapshot/timing tests and a new default-content-preservation import regression. TypeScript passed; lint passed without warnings.
- Production build: attempted; TypeScript stage passed, Vite/esbuild failed with Windows spawn EPERM. No successful production bundle is claimed.
- Browser: local IAB checked Create Game enters Setup without starting time, saving setup enters Lobby, invitation shortcut preserves the game route, personal-copy editor, default import preservation and optional marker removal, review/personal-save labeling. These are local UI checks only.
- Remote/backend: no remote access or migrations this batch; PGlite uses Auth/Storage metadata fixtures and pgcrypto, not real JWT/Storage HTTP/Realtime.
- Still required: phone/desktop multi-device Supabase integration, concurrent replacements, network/Storage cleanup failures, deadline races, scoring/voting finalization edge cases, accessibility and TV layout testing.

Stop after this organizer batch for review. Timing/photo/scoring reliability and presentation remain separate follow-on batches.
