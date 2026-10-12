# TRGGA

TRGGA is a culture-polling app for following the conversations moving the room. Run it from the repository root with:

```powershell
python -m http.server 8081 --bind 127.0.0.1
```

Open `http://localhost:8081`. Without Supabase settings the site runs in local mode: polls and votes stay in that browser and do not count as shared results.

## Deploy from GitHub to Netlify

The repository includes `netlify.toml` for publishing this static site from the repository root. In Netlify, choose **Add new site → Import an existing project**, connect your GitHub account, select `laudant0/trggr`, and deploy with the detected `netlify.toml` settings. Netlify will publish updates pushed to the connected branch automatically. After deployment, add the Netlify site's HTTPS URL to the Supabase Authentication URL configuration and provider redirect settings.

## Set up the shared backend

The Supabase migrations create profiles, polls, options, votes, and reports; enable row-level security; and expose narrow server-side RPCs to read published polls, create polls, vote, report polls, manage the signed-in user's profile, and discover opted-in members. Poll creators can add an optional image to each answer choice; images are resized to WebP thumbnails up to 640 × 420 pixels and 512 KB. The browser cannot write directly to database tables. A signed-in account can vote once per poll; creating polls and submitting reports also require sign-in. Public profiles never expose individual vote histories.

1. Create a Supabase project.
2. Apply `supabase/migrations/20261011000000_initial_schema.sql`. With the Supabase CLI, run `npx supabase init` once, then `npx supabase login`, `npx supabase link --project-ref YOUR_PROJECT_REF`, and `npx supabase db push` from this repository. Alternatively, paste the migration into your project's Supabase SQL Editor and run it.
3. Apply `supabase/migrations/20261011000100_profile_dashboard.sql` to add the profile bio, activity statistics, and authenticated profile read/update functions. If you use the Supabase SQL Editor, run this second migration after the initial schema.
4. Apply `supabase/migrations/20261011000200_discovery_multi_option_polls.sql` to add opt-in member discovery and server-validated two-to-four-option polls. If you use the SQL Editor, apply it after the profile migration.
5. Apply `supabase/migrations/20261011000300_poll_choice_images.sql` to enable secure thumbnail uploads and attach an optional image to each poll choice. If you use the SQL Editor, run it after the discovery/multi-option migration.
6. Apply `supabase/migrations/20261011000400_database_hardening.sql` for extra indexes, per-account rate limits, and automatic hiding of polls reported by five members.
7. Apply `supabase/migrations/20261011000500_member_polls.sql` so visitors can view and vote on a member's polls from their profile and poll creators link to their profiles.
8. Apply `supabase/migrations/20261011000600_connections_and_avatars.sql` for profile photo uploads (WebP, 256 KB, owner-only) and member connections (follow/followers).
9. Apply `supabase/migrations/20261011000700_pins_window_private_counts.sql` for private follower counts, poll pins, and the private iWindow insights.
10. Copy the project's **Project URL** and **publishable key** into `auth-config.js` as `supabaseUrl` and `supabasePublishableKey`. A legacy `anon` public key can also be used. Never put a Supabase `service_role` or provider secret key in browser code.
11. Add your final HTTPS website URL to Supabase **Authentication → URL Configuration**, along with `http://localhost:8081/login.html` for local testing.
12. In Supabase **Authentication → Sign In / Providers**, enable Google, Facebook, and X and add their OAuth client credentials. For Facebook sign-in, configure a Meta app and its Supabase callback URL; the `public_profile` and `email` permissions are required by Supabase's Facebook login flow.
13. Test sign-in on each provider, verify the user lands on their editable profile, confirm profile changes persist after refresh, verify opted-in members can be discovered and individual votes remain private, create polls with two through four options and optional thumbnails, verify poll creation and voting from separate accounts/devices, confirm duplicate votes and reports are rejected, and confirm anonymous direct database writes are denied. Reports are stored privately in `public.poll_reports`; review and moderation still need an assigned person and operating process.

The Google button uses Google sign-in (commonly a Gmail account); Facebook authenticates Facebook accounts, **not Instagram**; X uses X OAuth. Instagram profile linking or Threads integration is a separate feature, with separate Meta eligibility, review, and permissions. Neither is implemented by these sign-in buttons.

## Data behavior

The initial migration publishes eight sample questions into the shared database with **zero votes**. The earlier demo's invented counts are not imported or described as actual community results. Shared voting requires sign-in and is limited to one vote per Supabase user account per poll. This does not prove that one human cannot create multiple accounts.

The seeded topic list spans arts, automotive, books, business, creators, culture, education, entertainment, environment, fashion, finance, food, gaming, health, lifestyle, music, news, politics, relationships, science, sports, technology, travel, world, and Other. The Topics page reads categories from the database, while Explore shows the shared poll feed. To expand the list, add a row to `public.poll_categories` in the Supabase SQL Editor; the site will include it automatically.

On the website, the Explore and Topics labels are intentionally distinct from their legacy HTML filenames: `topics.html` is the live poll feed, and `explore.html` is the topic directory.

After voting, members can share the poll results to X and WhatsApp. The Instagram button uses the device's native share sheet when available; otherwise it copies the share text so it can be pasted into Instagram. Individual vote identities are never included in public profiles or public poll results.

## Launch readiness

The shared database schema and server-side authorization are implemented in this repository, but a live service is **not configured or ready to launch** until all migrations have been applied to your Supabase project, real project/provider credentials and production callback URLs have been configured, and end-to-end tests pass. The interface only displays the shared live feed when the backend is configured and reachable; otherwise it clearly identifies local-only data.

Before public launch, publish privacy/terms and contact details, decide who will review and act on poll reports, test account recovery and deletion, add operational backups/monitoring, and verify production security and mobile/desktop behavior. A basic `python -m http.server` is for development only, not production hosting.
