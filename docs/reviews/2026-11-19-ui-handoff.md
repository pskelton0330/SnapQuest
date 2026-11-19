# SnapQuest UI implementation handoff

**November 19, 2026 · Start with the waiting lobby.** A family organizer with a phone in one hand should be able to show the right team code, see who joined, and start the hunt from one place. Once play begins, the same phone in a player's hands should put a photo challenge within reach. Use those two tasks to judge layout decisions.

## Browser baseline

I opened the public player entry in Chromium and walked the signed-in journeys in the local React app using the existing Supabase fixtures from `tests/browser/home.spec.ts`. Mobile captures use a 390 × 844 CSS-pixel viewport. The desktop comparison uses 1280 × 800. The live site's build manifest identified `bc0dda6`; local screens came from `1bc2cbe` **plus the shared checkout's in-progress UI edits**. A clean checkout of the commit can therefore look different. These are rendered screens with synthetic teams for authenticated flows. Camera hardware, physical iOS keyboard behavior, real multiplayer timing, and first-time user performance still need hands-on evaluation.

| Journey and browser evidence | What the implementation should address |
|---|---|
| [Live player entry](2026-11-19-ui-screens/01-live-player-entry.jpg) and [local scanner entry](2026-11-19-ui-screens/11-local-player-entry.jpg) | The inspected public page instructs players to scan but only offers a field. The local page adds a scanner button, with the field still focused. Reconcile the deployed version before building anything new. |
| [Organizer home](2026-11-19-ui-screens/02-organizer-home.jpg) → [My hunts](2026-11-19-ui-screens/03-my-hunts.jpg) | Overview says “No hunts are running right now” and “Live or scheduled 1.” The waiting hunt and **Open lobby** are on the next screen. The home screen has all the data needed to guide the organizer there. |
| [Waiting lobby](2026-11-19-ui-screens/04-lobby.jpg) → [invitation cards](2026-11-19-ui-screens/12-invitation.jpg) | With one participant across two teams, the first QR starts at **y = 1,635 px** and measures **148 × 148 px**. Section shortcuts, start controls, scheduling and chat precede it. Team links and copy actions appear again under Quick team links. The invitation screenshot masks the sample codes and URLs. |
| [Create hunt](2026-11-19-ui-screens/05-builder.jpg) → [saved draft](2026-11-19-ui-screens/13-saved-draft.jpg) → [team setup](2026-11-19-ui-screens/14-team-setup.jpg) | I entered a venue and challenge and saved. The app returned to the hunt list with **Edit draft** and **Continue setup**. Continue setup opened another form for timing, assignments, teams, and voting. The handoff between forms makes the organizer choose how to continue. |
| [Player waiting](2026-11-19-ui-screens/06-waiting-player.jpg) | The sample manual-start lobby shows team customization and chat. Its “Waiting for the organizer” heading exists in the DOM but is hidden in the rendered layout. A visible check-in receipt would answer whether the player needs to do anything. |
| [Active player](2026-11-19-ui-screens/07-active-player.jpg) | With one team in the progress response and two challenges, the first capture control was already visible at **y = 537 px**. The timer appeared twice. The all-team rows precede the challenges. Measure a large hunt before claiming players always have to scroll. |
| [Mobile review](2026-11-19-ui-screens/08-review.jpg) and [desktop review](2026-11-19-ui-screens/10-desktop-review.jpg) | The same approved photo showed a failed preview and **Retry preview**. The page repeated the approval rule, and desktop labeled the workspace location “Results” while decisions were still editable. Distinguish photo availability, review decision, and published results. |
| [Player results](2026-11-19-ui-screens/09-results.jpg) | The local build already puts the team’s rank and leaderboard first. Preserve this improvement. The sharing actions follow the gallery and team details. |

## Navigation model

Use the hunt as the organizer's persistent context. **My hunts** is the organizer landing page. Put drafts, waiting games, live games, and games awaiting review in an unfinished section, with a next action on each row. Keep completed hunts in history, **Create hunt** visible, and the challenge library available from setup and secondary navigation. When someone manages and plays in the same hunt, label the switch with the destination and team. Browser Back, refresh, and switching roles should preserve the current hunt using the existing join, play, and manage routes.

| Hunt state | Organizer's next action | Player's first content |
|---|---|---|
| Draft | Continue setup | A player enters through a published invitation |
| Lobby open | Open lobby, then show the invitation or start | Team name and confirmation of check-in. Show who starts the game or the scheduled start time |
| Playing | View live hunt | Remaining time, team completion count, first unfinished challenge |
| Time up | Review photos | “Submissions closed” and what happens next |
| Reviewing | Continue review, then publish results | Voting if enabled and eligible, otherwise review status |
| Complete | View results | Team placement, leaderboard, gallery and sharing |

Use one prominent action **per task**. Showing a QR and starting a hunt are different tasks within the lobby. Keep both reachable and visually distinct. Use the brand collage at entry and the existing team colors and typography during play. Reserve strong color and visual weight for the current action. Pair status colors with text.

## Delivery sequence

### 1. Make the waiting lobby usable while people are gathering

**Entry points:** `src/pages/admin/OrganizerWorkspace.tsx`, `src/components/InviteLinksPanel.tsx`, `src/components/TeamLobby.tsx`, `src/theme.css`.

- Put the hunt title, waiting status and joined count first. For assigned teams, show a team picker and one QR with the selected team's name in large text. For balanced assignment, show the shared code and explain that teams are assigned on joining. Give the QR a light background, clear margins and a full-screen option.
- Under the code, offer **Copy invite link** and **See players**. Keep **Start hunt** distinctly labeled. For scheduled games, show the start time and label its override **Start early**. Preserve confirmations and the server’s timing rules.
- Move print-all, reissue links, reschedule, organizer-as-player, and diagnostics into clearly named secondary controls. Preserve unread chat and connection warnings, with a link to the affected panel. Reuse the existing invite recovery and roster handlers.
- **Acceptance:** On a 390 × 844 phone, open a waiting hunt and show the correct QR without scrolling, or in one tap on **Show team QR**. Show a second team’s code without losing the lobby. A second phone can scan it and sees the matching team before it joins. Returning from full-screen preserves selection. A missing, expired or unrecoverable invite has a visible recovery action. Viewing an invite must never rotate it.

### 2. Simplify player entry, waiting, and capture

**Entry points:** `src/App.tsx`, `src/components/QrInviteScanner.tsx`, `src/pages/participant/JoinGame.tsx`, `src/pages/participant/ParticipantGame.tsx`, `src/App.css`.

- At check-in, lead with **Scan a QR code** and offer **Enter a link or code**. Focus the field when manual entry is chosen. Keep permission denial, cancellation, invalid codes and expired invitations recoverable. Go directly to the team preview from an invitation link.
- In the waiting lobby, render “You’re checked in with Team Cedar” and, for manual start, “Your organizer will start the hunt.” Use visible HTML text. Show the scheduled time when applicable. Move name changes, selfie and roster into **Your team**.
- During play, put one timer and the team’s count above an unfinished challenge, its points, and **Take photo**. **All challenges** stays one tap away so players can capture finds in any order. Put standings and chat behind named controls. Show offline/stale feedback next to the data it affects.
- Keep the current challenge stable while someone chooses or uploads a photo. On server acceptance show **Submitted**, **Next challenge**, and a secondary **Replace photo**. A teammate’s replacement, a failed upload or an uncertain response should show the existing recovery path on the same challenge. When all challenges have photos, show the team’s summary and allow replacements while time remains.
- **Acceptance:** The capture action is visible at ordinary text size on 390 × 844 with **2 and 12 teams**. It remains reachable at large text sizes. No camera opens until requested. A player can recover from denied access and can manually enter an invite. A lost response cannot double-count an upload. The timer ending switches the player to closed submissions. Verify camera permission, decoding, and return from capture on a real iPhone.

### 3. Unify organizer home and draft setup

**Entry points:** `OrganizerWorkspace.tsx`, `ChallengeListEditor.tsx`, `src/lib/huntEditor.ts`, existing draft and publish RPCs.

- Give new organizers an empty state with **Create your first hunt**. For returning organizers, lead with their unfinished hunts and the state-specific actions above. Keep a live hunt and a waiting hunt individually identifiable when both exist. Retire duplicate dashboard counters after their useful information has a home.
- Present three steps: **Hunt details**, **Photo challenges**, **Teams & start**. Carry values backwards and forwards. Keep paste/import and the challenge library in the challenges step. Put voting and bonus rules behind an option. Show a final summary of team assignment and manual versus scheduled start.
- After a successful draft save, continue into the same hunt’s next step. Inspect the `create_hunt_draft` response and use the saved ID. Never select a hunt by title or assume the newest row is the one just saved. Existing drafts must reopen with their items, order, points and rules intact. If the current RPC can only save a valid draft with a challenge, keep earlier edits in the form and distinguish unsaved edits from saved progress.
- **Acceptance:** A new organizer creates two teams and two challenges, sees the correct code, and understands when the timer starts. A returning organizer resumes the intended draft with one action from home. Back, cancel, validation errors and an unsuccessful save preserve recoverable edits. Publishing twice after a network delay must not accidentally create or replace invites.

### 4. Separate operations, review, and published results

**Entry points:** `OrganizerWorkspace.tsx`, `HuntReview.tsx`, `ParticipantGame.tsx`, `HuntChat.tsx`. Keep existing scoring, invitation and upload rules.

- During a live hunt, put time remaining and team progress first. Keep **Add time**, roster and chat nearby. Give **End hunt** its own confirmation explaining that submissions will close. Maintain clear navigation back to the same hunt after using player view.
- Open review on submitted photos. Offer a list of undecided photos when present, counts, filters and an optional challenge-by-team grid for checking gaps. Show failed previews with retry independently of approval. Keep voting eligibility and counts understandable.
- **Resolve the approval wording against the deployed behavior before implementing review.** The browser fixture showed automatic approval. The shared tree also contains a proposed migration restoring pending review. Read the actual statuses and confirm the deployment decision before shipping copy or selecting a default filter. A UI release must never silently change scoring policy.
- Make **Publish results** state the consequence that final scores lock and become visible. On completion, lead with rank and leaderboard, group share/download/copy under **Share result**, and retain gallery access. Cover ties, zero scores, a missing selfie, and reopen-after-finalization.
- **Acceptance:** With eight teams and ten challenges but three submissions, the initial review shows three photos to inspect. Each decision can be changed until finalization. The server prevents finalization while required decisions are outstanding. Published ranks and totals match the stored final scores after refresh.

## Implementation and verification

1. Start from a fresh branch at current remote main. Check the deployed build manifest and compare with the shared working tree. It contains overlapping UI, tests, winner-card work, and migration proposals. Port the useful UI pieces deliberately. In particular, reuse the existing scanner, mobile stage disclosure, draft navigation warning, participant rank summary and submitted-photo filter where available.
2. Ship the four slices as reviewable changes. Keep existing RPCs, permissions, and mutation handlers in place while reorganizing screens. Separate presentational components when doing so lets the same hunt state drive mobile and desktop. Inspect both `App.css` and `theme.css` for conflicting visibility rules.
3. Reuse the sessions and synthetic hunts in `tests/browser/home.spec.ts`. Exercise both mobile WebKit and Chromium, a narrow 320 px view, 390 × 844, a desktop viewport, and enlarged text. Check keyboard navigation, dialog focus return, VoiceOver labels, and that sticky controls respect the iOS safe area. Test browser Back, refresh, offline/retry and switching between organizer and player. Keep confirmations for consequential actions.
4. Attach before/after screenshots of each changed state to its PR. Capture the first viewport **before scrolling** with matching data, and record tap count and whether the key action is visible. A passing screenshot or automated check alone cannot tell us whether the wording makes sense to a first-time host.
5. **Usability sign-off:** Give a first-time organizer and player two phones and a sample hunt. Ask them to get onto the same team, start play, submit a photo, review it, and find the final placement. Observe without naming buttons. Record the first wrong turn, number of taps and any request for help. Proposed success targets: show the requested QR in at most one tap from the lobby; identify the waiting state without help; take or choose a photo in one tap from its challenge; reach published rank without scrolling on a standard phone. Repeat with scheduled start and shared assignment.
6. After each approved release, verify the Pages build SHA and revisit the changed entry point. Use synthetic data for any end-to-end run. Record physical-device results separately from browser emulation. Release the lobby and player changes first so their usability findings can inform setup and review.

