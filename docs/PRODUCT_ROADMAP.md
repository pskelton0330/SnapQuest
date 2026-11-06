# SnapQuest product roadmap

Last updated: November 6, 2026

This document records the current product sequencing decision for SnapQuest. It complements the detailed requirements in `SnapQuest_Revised_PRD_v2.0.md`; it does not delete or silently weaken those requirements.

## Product direction

Launch a dependable, inexpensive core scavenger-hunt experience first. The first release should prove that organizers can create and run a hunt, teams can participate from their phones, and everyone can see a satisfying result at the end. Premium media and AI capabilities come after that foundation is stable and tested in real hunts.

## SnapQuest Core launch scope

The initial launch candidate includes:

- Organizer authentication and hunt creation.
- Team setup with team names, invitations/QR codes, and team selfies.
- Scheduled hunts plus organizer-controlled Start Now and timing controls.
- Mobile photo capture, replacement, recovery, and private storage.
- Team and all-team progress bars, including time progress.
- Organizer review, scoring, finalization, and results.
- A winner celebration card built from the winning team selfie or a safe placeholder.
- Download and native device sharing of the celebration card, with copyable caption/link support where available.
- Backend audit logging and the build/test evidence needed to operate the product safely.

The initial celebration-card feature is implemented: organizers and eligible winning teams can generate a branded image in the browser and share it through the device share sheet or download it. This keeps the core sharing path much cheaper to operate than server-rendered video. Durable server-generated assets remain a separate option if the product needs permanent share pages or consistent background processing.

## Winner celebration card direction

After an organizer finalizes scores, show a celebration card for the winning team. The initial template should support:

- Team selfie, or a team-name/color placeholder when no selfie exists.
- Winning team name and trophy/award treatment.
- Hunt title, final score/rank, venue or date when appropriate, and SnapQuest branding.
- Accessible text alternatives and a readable layout for long names.
- Export profiles for square, portrait, story, and link-preview use as demand justifies them: 1080x1080, 1080x1350, 1080x1920, and 1200x630.
- User-triggered `Share`, `Download`, and `Copy caption` actions. Sharing must never require social passwords or expose private storage URLs.

The first release uses the browser/OS share sheet and download fallback. Additional acceptance work remains for real iOS/Android behavior and varied selfie-image inputs. Automatic posting to individual social networks is a separate integration project requiring platform-specific app registration, permissions, review, and ongoing maintenance.

## Premium and later roadmap

These are intentionally deferred until the core hunt and celebration-card flow are reliable:

### Premium media

- One branded video montage per finalized hunt.
- Multiple visual themes and organizer branding.
- Licensed music catalog and music attribution.
- Preview, download, retention, deletion, and controlled sharing for rendered media.
- Optional higher-quality or faster rendering tiers.

### AI-assisted hunt creation

- Organizer describes a theme, location, audience, difficulty, and duration in plain language.
- SnapQuest proposes structured challenges, points, rules, team settings, and optional wording.
- The organizer reviews and edits the proposal before publishing it.
- AI must not silently publish a hunt, judge photos, or make irreversible scoring decisions.
- Keep generation behind explicit usage limits and pricing so inference cost cannot grow unexpectedly.

### Other possible paid features

- More teams/challenges and longer media retention.
- Custom templates, logos, colors, and event branding.
- Organizer analytics and repeat-event history.
- Direct social integrations after the native share flow proves demand.
- Premium music and advanced celebration-card variants.

## Architecture principles for the transition

Keep gameplay, results, and media outputs separate. A finalized hunt should be able to produce one or more output types later, such as a celebration card, montage, or AI-generated recap, without changing the scoring model. Results must remain usable if a media output fails or is deleted.

For every premium output, preserve:

- Private media access and short-lived signed URLs.
- Idempotent generation keyed to the finalized game/version.
- Explicit status, retry, deletion, and failure handling.
- No credentials in the browser or generated files.
- Cost visibility before enabling a provider or paid rendering/inference service.

## Sequencing decision

2026-11-06: The initial winner celebration card is part of the core product and has been implemented. Continue prioritizing core hunt reliability, real-device acceptance, privacy/lifecycle decisions, and the review-backlog gates. Treat video montage, automatic social-network publishing, and AI-assisted hunt generation as post-core/premium roadmap work. The broader PRD v2 concepts remain documented for later design and implementation gates.
