# Supabase setup

Levels, weapons and enemies live in Supabase. If Supabase is down, slow or has no valid
levels, the game falls back to the bundled `fallback-data.json`.

One-time setup in the Supabase dashboard:

1. Open the **SQL editor**. Existing project: run the migration, then `seed.sql`.
   Fresh project: `schema.sql`, then `seed.sql`. (Migrations live in
   `migrations/`; for this release that is `migrations/2026-11-25-beer-party.sql`.)
   One-step option for an existing project: run `upgrade-beer-party.sql` once (the
   migration followed by the seed; regenerate with `npm run upgrade-sql`).
   `seed.sql` is generated from `fallback-data.json` with `npm run seed`.
   Both `schema.sql` and the migration also create the public `sprites` Storage bucket
   (images up to 1 MB: PNG, JPEG, SVG, WebP) that only admins can upload to.
2. Under **Authentication**, create a user with an email and password.
3. Copy that user's UUID and run, in the SQL editor:

   ```sql
   insert into admins(user_id) values ('<uuid>');
   ```

4. Disable sign-ups under **Authentication → Sign In / Providers**.

All SQL files are safe to re-run. Only the publishable key is used in the site's code;
Row Level Security lets anyone read and only users listed in `admins` write (tables and
the `sprites` bucket alike).

To confirm the game reads from the database, open `play.html` with the browser console
open: it logs `Game data loaded from db.` If it logs `Game data loaded from fallback.`
instead, a `Using fallback data: ...` warning just before it says why (for example a
missing grant, no published levels, or a timeout).
