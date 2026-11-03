# Changelog

## 2026-11-03 Aggregate team progress

- Added migration `202610300009_team_progress.sql` with a participant-authorized aggregate progress RPC.
- Participants can see each team’s accepted photo-slot count and total challenge count during active play; photo paths, submitters, and challenge details remain excluded.
- Added local PGlite authorization and data-shape coverage plus participant progress bars with accessible progress semantics.
- Checks: 49 automated tests pass; TypeScript, lint, and production build pass. Migration remains locally staged and has not been applied to a remote Supabase project.

## 2026-11-03 Organizer-as-player switch

- Added `Join this team` to organizer-visible team invitation cards. It uses the existing permanent Auth identity and invitation RPC, so a host joins once without creating a guest identity or silently changing teams on later scans.
- Added a direct `Manage game` return link for permanent-account players and a route that reopens the same hunt in the organizer workspace.
- Added regression coverage proving the selected team token is sent without anonymous replacement; organizer display names are bounded to the participant limit.
- Checks: 48 automated tests pass; TypeScript, lint, and production build pass. Live Supabase, browser, and physical-device verification remain outstanding.

## 2026-11-02 PRD v2 session restoration batch

- Adopted consolidated v2.0 requirements for the version-one web product; recorded ID-level gaps, phased plan, decision gates and all 36 acceptance scenarios.
- Invitation/game routes wait for initial Auth restoration; signed-out game routes explain lost-credential limitations.
- Permanent and guest identities restore before join; returning permanent members can rejoin without name reentry. Restoration errors offer retry rather than anonymous replacement.
- Participant context refreshes on visibility, focus and online return. Full physical-phone and subscription recovery remain unverified.
- Added seven helper tests and one local database rejoin/ownership regression: 47 tests pass, TypeScript and lint pass. Production bundling remains blocked by esbuild spawn EPERM.
- No new migration, live configuration, media deletion or deployment. Host Play/Manage switching, quick review, progress, montage and media work remain pending.


## 2026-11-01 Organizer usability batch

- Clarified Create Game versus confirmed Start Now; retained both scheduled and immediate configuration.
- Added lifecycle orientation, stage guidance and in-page controls/team/invitation shortcuts to the existing game manager.
- Distinguished publishing and personal-save labels; explained unfinished browser drafts and public template content.
- Preserved pasted wording by default, with explicit optional bullet/number cleanup and review in the existing editor.
- Added import-content regression coverage and documented existing gaps without changing gameplay rules or remote data.
- Checks: 39 automated tests pass; TypeScript and lint pass. Production build attempted but blocked by esbuild spawn EPERM. Local browser checks performed; no remote or physical-device verification.
