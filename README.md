# På Spåret-gissaren 🚂

Family game: guess the three På Spåret cities **before** Friday's 20:00 episode.

- `/` – enter your name + three cities for this week's round (editable until Friday 20:00 Swedish time). Other people's guesses stay sealed until the episode starts.
- `/admin` – password-protected page for entering the correct cities and removing guesses.

Scoring: 1 point per correct city, in any order.

## Stack

Static PWA (no build step) in `public/`, hosted on Vercel. Data lives in Supabase; the browser
only calls Postgres RPC functions with the publishable key (see `supabase/migrations/0001_init.sql`).

## Setup

1. Run `supabase/migrations/0001_init.sql` in the Supabase SQL editor.
2. Set the admin password:
   ```sql
   insert into public.app_secrets (key, value)
   values ('admin_password', extensions.crypt('your-password', extensions.gen_salt('bf')))
   on conflict (key) do update set value = excluded.value;
   ```
3. Supabase URL + publishable key are in `public/js/common.js`.
