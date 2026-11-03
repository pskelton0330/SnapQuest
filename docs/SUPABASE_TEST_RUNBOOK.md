# SnapQuest Supabase test runbook

Use an isolated test hunt and test email accounts. Never paste invitation tokens, email magic links, service-role keys, or private photo URLs into notes or bug reports.

## 1. Public deployment smoke test

Open `https://pskelton0330.github.io/SnapQuest/` on desktop and on the test phone.

Expected:

- The SnapQuest home screen loads.
- Browser developer tools show no failed `/SnapQuest/assets/` requests.
- The page URL stays under `/SnapQuest/`; it must not redirect to localhost.

## 2. Supabase configuration checks

In Supabase Authentication → URL Configuration:

- Site URL: `https://pskelton0330.github.io/SnapQuest/`
- Redirect URL: `https://pskelton0330.github.io/SnapQuest/**`
- Local redirects may also include `http://127.0.0.1:5173/**` and `http://localhost:5173/**`.

In Authentication → Providers:

- Email is enabled.
- Anonymous sign-ins are enabled.

In SQL Editor, verify the progress RPC exists:

```sql
select to_regprocedure('public.get_hunt_progress(uuid)') is not null as progress_rpc_available;
```

The result must be `true` before testing progress bars.

## 3. Organizer login

1. Open the public URL on the phone.
2. Select Organizer Login.
3. Request a magic link for a provisioned organizer email.
4. Open the newest email on the same phone.

Expected:

- The link returns to `https://pskelton0330.github.io/SnapQuest/`.
- Safari does not mention localhost, `127.0.0.1`, or an unreachable server.
- The organizer workspace opens.
- Refreshing the page preserves the session.

If the link is wrong, copy only its destination host/path—not the full token—and correct Supabase URL Configuration before requesting another link.

## 4. Create and join a test game

1. Create a test hunt with at least two challenges.
2. Publish it with two teams and individual QR codes.
3. Open Team A’s QR link on phone A and join as `Test A`.
4. Open Team B’s QR link on phone B and join as `Test B`.
5. Refresh both phones and lock/unlock each phone once.

Expected:

- Each phone keeps its identity and assigned team.
- Reopening the invitation does not ask for the name again.
- A participant cannot be silently moved by scanning another team’s QR code.
- The organizer can use `Join this team`, enter Play mode, and return with `Manage game`.

## 5. Active-play and progress test

Start the test game, then submit one photo from Team A.

Expected:

- Team A’s progress increases by one accepted slot.
- Team B’s progress remains unchanged.
- Both phones can see aggregate counts for all teams.
- Neither phone can see rival photo paths, submitter identities, or rival photos during play.
- Replacing a Team A photo does not increase the count a second time.

Submit a second photo, then refresh and briefly disable/re-enable the phone connection.

Expected:

- The count reconciles to the server value.
- The accepted photo remains present.
- No duplicate participant or duplicate submission is created.

## 6. Authorization checks

- A signed-out visitor can view the public landing page but cannot organize a game.
- An anonymous participant cannot open organizer tables or manage another game.
- A participant from another team cannot read rival submissions during active play.
- A second organizer cannot manage the first organizer’s game.

Record the test environment, device/browser, game ID, time, expected result, actual result, and screenshots. Do not record credentials or bearer tokens.

## Current verification boundary

This runbook verifies the deployed invitation/session and aggregate-progress slice. Team selfie, quick review, montage generation, media deletion, and physical multi-phone acceptance remain separate pending features.
