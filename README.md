# TRGGA

TRGGA is a browser-based culture poll prototype. Run it from the repository root with:

```powershell
python -m http.server 8081 --bind 127.0.0.1
```

Open `http://localhost:8081`. Without Supabase settings the site explicitly runs in demo mode: polls and votes are stored in that browser only and are not real platform-wide results.

## Deploy from GitHub to Netlify

The repository includes `netlify.toml` for publishing this static site from the repository root. In Netlify, choose **Add new site → Import an existing project**, connect your GitHub account, select `laudant0/trggr`, and deploy with the detected `netlify.toml` settings. Netlify will publish updates pushed to the connected branch automatically. After deployment, add the Netlify site's HTTPS URL to the Supabase Authentication URL configuration and provider redirect settings.

## Set up the shared backend

The Supabase migrations create profiles, polls, options, votes, and reports; enable row-level security; and expose narrow server-side RPCs to read published polls, create polls, vote, report polls, and manage the signed-in user's profile. The browser cannot write directly to database tables. A signed-in account can vote once per poll; creating polls and submitting reports also require sign-in.

1. Create a Supabase project.
2. Apply `supabase/migrations/20261011000000_initial_schema.sql`. With the Supabase CLI, run `npx supabase init` once, then `npx supabase login`, `npx supabase link --project-ref YOUR_PROJECT_REF`, and `npx supabase db push` from this repository. Alternatively, paste the migration into your project's Supabase SQL Editor and run it.
3. Apply `supabase/migrations/20261011000100_profile_dashboard.sql` to add the profile bio, activity statistics, and authenticated profile read/update functions. If you use the Supabase SQL Editor, run this second migration after the initial schema.
4. Copy the project's **Project URL** and **publishable key** into `auth-config.js` as `supabaseUrl` and `supabasePublishableKey`. A legacy `anon` public key can also be used. Never put a Supabase `service_role` or provider secret key in browser code.
5. Add your final HTTPS website URL to Supabase **Authentication → URL Configuration**, along with `http://localhost:8081/login.html` for local testing.
6. In Supabase **Authentication → Sign In / Providers**, enable Google, Facebook, and X and add their OAuth client credentials. For Facebook sign-in, configure a Meta app and its Supabase callback URL; the `public_profile` and `email` permissions are required by Supabase's Facebook login flow.
7. Test sign-in on each provider, verify the user lands on their editable profile, confirm profile changes persist after refresh, verify poll creation and voting from separate accounts/devices, confirm duplicate votes and reports are rejected, and confirm anonymous direct database writes are denied. Reports are stored privately in `public.poll_reports`; review and moderation still need an assigned person and operating process.

The Google button uses Google sign-in (commonly a Gmail account); Facebook authenticates Facebook accounts, **not Instagram**; X uses X OAuth. Instagram profile linking or Threads integration is a separate feature, with separate Meta eligibility, review, and permissions. Neither is implemented by these sign-in buttons.

## Data behavior

The initial migration publishes eight sample questions into the shared database with **zero votes**. The previous prototype's invented counts are not imported or described as actual community results. Shared voting requires sign-in and is limited to one vote per Supabase user account per poll. This does not prove that one human cannot create multiple accounts.

The seeded topic list spans arts, automotive, books, business, creators, culture, education, entertainment, environment, fashion, finance, food, gaming, health, lifestyle, music, news, politics, relationships, science, sports, technology, travel, world, and Other. Explore filters and the poll form read categories from the database. To expand the list, add a row to `public.poll_categories` in the Supabase SQL Editor; the site will include it automatically.

## Launch readiness

The shared database schema and server-side authorization are implemented in this repository, but a live service is **not configured or ready to launch** until both migrations have been applied to your Supabase project, real project/provider credentials and production callback URLs have been configured, and end-to-end tests pass. The interface only displays the shared live feed when the backend is configured and reachable; otherwise it labels its local data as demo mode.

Before public launch, publish privacy/terms and contact details, decide who will review and act on poll reports, test account recovery and deletion, add operational backups/monitoring, and verify production security and mobile/desktop behavior. A basic `python -m http.server` is for development only, not production hosting.
