# SnapQuest organizer experience and release plan

**Handoff date:** November 23, 2026 · **Review evidence:** November 20, 2026 · **GitHub baseline:** [`bcd2e0c`](https://github.com/pskelton0330/SnapQuest/commit/bcd2e0c1c56a1219b717f52602d37350ea772f3e)

A host should be able to find a complete hunt another group actually played, understand what the group did, and turn it into a private game of their own. Start a returning organizer in **My Hunts**. Put discovery in **Hunt Library**. Use the existing SnapQuest editor, lobby, photo review, results, and visual style throughout.

**November 24 progress.** The implementation is now on GitHub. [Photo privacy, PR #7](https://github.com/pskelton0330/SnapQuest/pull/7) passed both workflows, including the isolated Storage API checks. [Resumable admin deletion, PR #8](https://github.com/pskelton0330/SnapQuest/pull/8) passed both workflows, including an interrupted cleanup exercised through the Edge Function. [My Hunts and Hunt Library, PR #6](https://github.com/pskelton0330/SnapQuest/pull/6) includes draft recovery, the server clock, organizer confirmation recovery, and Community handoff and moderation. Its [isolated Supabase tests](https://github.com/pskelton0330/SnapQuest/actions/runs/45391751662) and [browser checks](https://github.com/pskelton0330/SnapQuest/actions/runs/45391751567) track the release candidate. Local checks passed 90 unit and database tests and all 328 browser tests across desktop and mobile Chromium and WebKit. The isolated Supabase checks passed on the same organizer commit, `7365982`. The two-organizer Christmas Lights scenario passed through Supabase HTTP. The library migration is now `20261124121355_hunt_library_completion_snapshots.sql`, ordered after the photo privacy and deletion migrations. Promotion, external inbox delivery, and the pilot games are separate milestones.

## What the organizer should see

Illustrative desktop layout, using a fictional hunt:

```text
Workspace navigation     My Hunts
  My Hunts               [Create a Hunt]   [Browse Hunt Library]
  Hunt Library
                         Christmas Lights Hunt    Draft       [Edit draft]
                         Park Photo Walk          Waiting     [Open lobby]
                         Downtown Art Hunt        Playing     [Manage live hunt]
                         Fall Colors              In review   [Review photos]
                         Winter Lights            Completed   [View results] [Use again]
```

**My Hunts** includes every draft, copy, game in progress, and completed game belonging to the signed-in organizer. Keep completed games easy to find. At the top, **Create a Hunt** opens a blank editor and **Browse Hunt Library** opens discovery. Show each action once in an empty workspace. On phones, stack the actions and cards, keep each status next to its action, and keep both destinations reachable with touch or keyboard. Use the older [organizer screen references](reviews/2026-11-19-ui-handoff.md) for visual continuity. The labels and behavior in this handoff are the target.

**Hunt Library** returns one result per complete hunt. Searching “Christmas lights” should find a *Christmas Lights Hunt*. A preview shows its title, description when available, duration in minutes, all rules, and the full ordered list of challenges with every clue and point value. Opening, searching, or leaving a preview creates nothing. Keep reusable individual prompts in the editor and preserve existing challenge records.

**Copy to My Hunts** creates one independent private draft for the current organizer and opens it in the existing editor. The host can rename it, choose a duration in positive whole minutes, keep suggested rules or add custom ones, and add, edit, remove, or reorder challenges. Saving changes that draft. It continues into normal team setup and invites. **Use again** on a completed game opens a fresh editable draft based on that game. Both paths start with fresh game state. The source game, results, and published challenge list retain their history.

**Finishing a game** means publishing final results after photo review, including a tie. Before finalization, show: **“Finishing this game adds its rules and challenge list to the Hunt Library. Player photos and results stay with this game.”** Publish one reusable snapshot per completed game, even after a retry or reopened results. Drafts, waiting games, active games, and games awaiting review stay out of discovery. The public response should include only reusable hunt content and necessary catalog metadata. Enforce this in the database as well as the preview. Exclude participants, team identities, media and storage paths, selfies, chat, invitations, and scores. A copied or replayed game can later publish its own as-played version when it finishes.

**Game-day continuity and administration.** A player joining a team by code enters a name once. On the same browser, refresh and rescan should restore the same membership and name. Keep team selfie entry available and attribute submissions to the photographer and team inside the game. System admins need to see all games and moderate public entries. When a creator's account is removed, eligible public content transfers to **SnapQuest Community**. Keep deletion controls in the system-admin workspace.

## Open work in recommended order

These are the nine findings from the November 20 review. “Live” refers to the reviewed deployed revision. “Candidate” refers to the local Hunt Library work. Check the current revision and record evidence before marking an item complete.

| Priority and scope | Problem and action | Acceptance evidence |
| --- | --- | --- |
| 1 · Live · Photo privacy | After play, the gallery returns all submission paths and Storage permits same-game participants to read other teams' pending or rejected photos. Restrict other teams to approved photos in both layers. Preserve organizer review and own-team access. Clear withdrawn previews and define the lifetime of previously issued links. | With two teams and real local Storage, check pending → approved → rejected. Confirm gallery data, new preview access, and existing-link expiry for each viewer. |
| 2 · Live · Deletion recovery | Admin deletion removes files before database cleanup. A later failure can leave surviving records pointing to missing media. Persist an authorized deletion job and its inventory, recheck eligibility transactionally, and resume file, database, and Auth work by job ID. | Interrupt each stage for an account and a game, retry the same job, then check all intended records, media references, and the audit trail. Exercise the actual admin Edge Function. |
| 3 · Candidate · Community handoff and moderation | The immutable-snapshot trigger also rejects the admin transfer and withdrawal operations. Both failures were reproduced locally. Allow narrowly authorized ownership transfer and moderation while protecting published rules and challenges. | A finalizes, B copies, an admin removes A's account, and Community owns the public entry. The admin can then withdraw it. B's saved copy still opens. Ordinary organizers cannot perform either admin action. |
| 4 · Live and candidate · Draft identity | **Cancel → Keep editing → Save** clears the saved draft ID and sends a create request. Defer clearing editing state until discard is confirmed or save succeeds. | Change a saved draft and a replay, take that path, and verify the same ID is updated, the count is unchanged, and the edit survives reopening. |
| 5 · Candidate · Browser checks | Duplicate **Create a Hunt** controls stop three organizer tests before their assertions. A test still expects **Continue setup**. A WebKit photo test also exposed an inconsistent approval fixture. Use one empty-state action, align tests with **Edit draft**, and match the server's pending default. | Run the complete candidate twice across desktop and mobile Chromium and WebKit. Ensure editor, discard, reorder, accessibility, and photo-replacement assertions actually run. |
| 6 · Candidate · Copy and replay retries | A lost response after insert can create a second draft on retry. Failure while opening the editor can hide a successful copy. Add an organizer-scoped request ID and make the saved draft reopenable. | Drop the response after commit and fail the first editor read. A retry opens the same draft. A deliberate second copy gets a new ID. |
| 7 · Live and candidate · Status-specific actions | My Hunts derives expiry from the device clock when the list loads. Its card can disagree with the lobby when a game starts or ends. Use effective status and deadlines from the server. Refresh at transitions and on return. | Move the device clock one day ahead and behind. Cards and lobby agree through scheduled start, manual start, early end, and review. |
| 8 · Live · Organizer sign-up | New unconfirmed accounts have no dedicated resend action. Add a confirmation-pending screen with resend and change-email choices, plus recovery for existing passwordless users. Check configured sender, redirects and delivery events. The earlier missing email's cause was unconfirmed. | Use authorized staging inboxes for a new account, a returning passwordless account, and an expired link. Verify delivery and mobile redirect while preserving neutral account-existence messages. |
| 9 · Live and candidate · Search and admin scale | The proposed library loads every full challenge list before searching. Admin overview scans users and games into memory. Page summaries and admin searches on the server, and fetch challenges when a preview opens. | Search a synthetic catalog of 1,000 hunts and return at most 25 summaries. Preview one full hunt. Measure response size, requests, and p95 latency as the catalog grows. |

### Where to work

- **Workspace, copy, replay, and status** — [OrganizerWorkspace.tsx](../src/pages/admin/OrganizerWorkspace.tsx), [HuntReview.tsx](../src/pages/admin/HuntReview.tsx), [editor contract](HUNT_EDITOR_CONTRACT.md).
- **Gallery privacy** — [gallery RPC](../supabase/migrations/202611060016_reliability_invariants.sql), [Storage policy helper](../supabase/migrations/202611070026_private_team_selfie_storage.sql), [participant gallery](../src/pages/participant/ParticipantGame.tsx). Use a new migration to correct deployed behavior.
- **Admin handoff and deletion** — [Edge Function](../supabase/functions/system-admin/index.ts), [community transfer and deletion procedures](../supabase/migrations/20261120135941_system_admin_deletion_reference_safety.sql), [privacy lifecycle decisions](PRIVACY_LIFECYCLE_POLICY.md).
- **Sign-up and quality checks** — [organizer authentication](../src/App.tsx), [database scenarios](../tests/template-database.test.mjs), [browser scenarios](../tests/browser/home.spec.ts), [isolated Supabase runbook](SUPABASE_TEST_RUNBOOK.md).

## Release sequence and proof

1. **Fix items 1–3 first.** Check the visibility matrix with organizer, own team, other team, and unrelated user. Run deletion and transfer interruption tests against disposable data. Coordinate the live privacy/deletion fixes with the candidate snapshot change.
2. **Finish the organizer journey.** Resolve items 4–8 and run the two-host scenario below with an isolated Supabase stack. Gate promotion on the app checks, migration and Edge checks, and a compatible deployed schema. Schedule item 9 against measured catalog growth.
3. **Use the two-organizer scenario as the release demonstration.** A creates *Christmas Lights Hunt* with distinctive rules and ordered clues. Check discovery as B during draft, waiting, play, and review. Finalize a tie, retry finalization, and reopen results. Exactly one entry appears. B previews every clue without creating a draft, copies once, removes a challenge, adds another, reorders, changes the rules and duration, saves, and continues into team setup. Check B's saved ID and fresh roster, invites, submissions, and scores. A still sees the original results and can use the hunt again. The public preview still matches A's played list. Inspect the database response as well as the screen. Repeat the main path at phone and desktop widths.
4. **Release and historical publishing are separate decisions.** Record the tested commit, migrations, checks, and remaining risks in the handoff before promotion. The proposed snapshot migration starts with future completions. An empty library can be populated by newly played pilot hunts.

**Evidence available from November 20.** The reviewed live revision matched GitHub main. Production had 36 applied migrations through `20261120135941`, 18 of 18 public tables with row-level security, and two private media buckets. All seven saved media references matched a Storage object. There were six games, three completed games, zero public templates, and 104 individual saved challenges. On the local candidate, 87/87 unit and database tests passed. The full browser run passed 303/316 across four configurations with mocked Supabase responses. Twelve failures shared the duplicate-button issue. The separate WebKit photo-status case passed twice in isolation. The build passed. External inbox delivery, physical phone capture, and a restore rehearsal still need evidence.

## How to tell whether the product works for hosts

Start with three willing groups playing new hunts in different settings, such as a Christmas lights walk, a park, and an indoor rainy-day game. Watch someone who did not write the hunt host the next game. These are proposed pilot targets:

- **Discovery:** Four of five first-time hosts can find a suitable hunt and explain what their group will do within one minute. If they struggle, try simple host-chosen indoor/outdoor and accessibility tags or show one sample clue in search results.
- **Game day:** Nine of ten players can join the correct team and see their own name within one minute without help. Check rescan, refresh, real camera capture, and a weak connection on iPhone and Android. A host readiness view could show team counts and missing selfies.
- **Reuse:** A second organizer can find the first group's hunt, replace one challenge, and reach setup within three minutes. Track the path from completed hunt to preview, copy, and an actual second game. A final preview of public text can help hosts spot names or home addresses typed into clues before sharing.

When handing work to the next agent, add the PR or commit, environment, acceptance result, and any remaining decision to this file.
