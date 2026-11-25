# Supabase setup

Levels, weapons and enemies live in Supabase. If Supabase is down, slow or has no valid
levels, the game falls back to the bundled `fallback-data.json`.

One-time setup in the Supabase dashboard:

1. Open the **SQL editor**. Existing project: run the migration, then `seed.sql`.
   Fresh project: `schema.sql`, then `seed.sql`. (Migrations live in
   `migrations/`; for this release that is `migrations/2026-11-25-beer-party.sql`.)
   One-step option for an existing project: run `upgrade-beer-party.sql` once (the
   migration followed by the seed; regenerate with `npm run upgrade-sql`).
   `seed.sql` is generated from `fallback-data.json` with `npm run seed`. Re-running it
   resets the bundled starter rows (see the warning under "Upgrade an existing project").
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

## Upgrade an existing project (beer party)

For a project that was set up before the beer-party release (it already ran `schema.sql`):

> **Warning: the seed overwrites the bundled starter rows.** Running `upgrade-beer-party.sql`
> (or `seed.sql`) resets these rows to the bundled version, **including Published and Order**:
>
> - weapons `out-of-office`, `coffee-machine`, `cafe`, `pizza-hut`, `hr-talk`
> - guests `recruiter`, `sales-rep`, `quick-question`, `facilities-guy`, `wine-snob`
> - levels `level-1`, `level-2`
>
> Any changes you made to them in the admin are lost. Save them first: in the admin, click
> **Export JSON** (or copy the values), and re-apply them after the upgrade. Rows with other
> ids are not touched.

1. In the **SQL editor**, run `upgrade-beer-party.sql` once. It is the migration followed
   by `seed.sql`, in one file. (Equivalent: run `migrations/2026-11-25-beer-party.sql`, then
   `seed.sql`.) Both are safe to re-run. The migration gives every existing level a guest
   list (the guests its waves use) and swaps Wine Tasting for Café; the seed then upserts the
   bundled weapons, guests and levels by id (see the warning above). Weapons, guests and
   levels you made yourself keep their rows.
2. Under **Storage**, check that the `sprites` bucket exists and is public. If it doesn't,
   the migration's bucket step didn't run: run the migration again.
3. Open `play.html` with the browser console open and check it logs
   `Game data loaded from db.` (not `... from fallback.`; see above for what the warning
   before it means).

Regenerate the files after changing `fallback-data.json`: `npm run seed`, then
`npm run upgrade-sql` (both from `tower-defence/`).
