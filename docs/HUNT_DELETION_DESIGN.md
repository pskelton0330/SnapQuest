# Organizer hunt deletion

In **My Hunts**, the owner can delete a draft, a game in progress, or a completed game. The confirmation names the hunt and requires its exact title. Deleting a game removes its roster, photos, selfies, messages, invitations, and scores. An existing Hunt Library entry is a separate record of reusable content and stays available. Audit events follow the existing retention policy.

## How deletion works

1. The Edge Function verifies the signed-in account. The database then checks ownership and the typed title. Guests, other organizers, and anonymous callers cannot start or resume the deletion.
2. The database locks the hunt, records its private media inventory in a service-only job, and deletes the game and its dependent rows in the same transaction. The lock coordinates with new uploads and invitation redemption then stops working.
3. The existing deletion worker processes the stored inventory. When it finishes, the job clears its stored paths and title. If cleanup stops midway, **My Hunts** shows **Resume cleanup** after the organizer reopens the page. The same job can be resumed by the owner or a system administrator.
4. The organizer sees a completion message after the worker has removed the inventoried objects. This removes the game's application data. Provider backup retention is covered separately.

## Verification

The isolated stack exercises the real Edge Function and private Storage with synthetic hunts. It checks ownership, typed confirmation, recovery after the database step, and retrying a completed job. Local database tests verify that an existing public hunt preview survives deletion of its source game. The browser test checks that canceling leaves the hunt in place and interrupted cleanup can resume after a reload.

Use the [privacy lifecycle](PRIVACY_LIFECYCLE_POLICY.md) for retention questions, including participant requests and scheduled deletion.
