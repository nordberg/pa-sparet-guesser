-- På Spåret-gissaren: schema
-- Guesses are written and read only through RPC functions so the server decides
-- which Friday is "open" and hides other people's cities until 20:00 on air day.

create extension if not exists pgcrypto with schema extensions;

-- Correct answers per episode (one row per Friday)
create table public.rounds (
  air_date date primary key,
  answer1 text,
  answer2 text,
  answer3 text,
  updated_at timestamptz not null default now()
);

create table public.guesses (
  id bigint generated always as identity primary key,
  air_date date not null,
  player text not null check (char_length(btrim(player)) between 1 and 40),
  city1 text not null check (char_length(btrim(city1)) between 1 and 80),
  city2 text not null check (char_length(btrim(city2)) between 1 and 80),
  city3 text not null check (char_length(btrim(city3)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index guesses_round_player_uq on public.guesses (air_date, lower(btrim(player)));

-- Private: admin password hash. RLS on and no policies => invisible to the API.
create table public.app_secrets (
  key text primary key,
  value text not null
);

alter table public.rounds enable row level security;
alter table public.guesses enable row level security;
alter table public.app_secrets enable row level security;

create policy "rounds readable" on public.rounds for select to anon, authenticated using (true);

-- The Friday the open round belongs to. Flips to next Friday at 20:00 Stockholm time.
create or replace function public.current_round_date()
returns date language sql stable set search_path = '' as $$
  select d + (((5 - extract(isodow from d)::int + 6) % 7) + 1)
  from (select ((now() at time zone 'Europe/Stockholm') - interval '20 hours')::date as d) s
$$;

create or replace function public.round_deadline(p_air_date date)
returns timestamptz language sql immutable set search_path = '' as $$
  select (p_air_date + time '20:00') at time zone 'Europe/Stockholm'
$$;

create or replace function public.list_guesses()
returns table (id bigint, air_date date, player text, city1 text, city2 text, city3 text, updated_at timestamptz, sealed boolean)
language sql stable security definer set search_path = '' as $$
  select g.id, g.air_date, g.player,
    case when s.sealed then null else g.city1 end,
    case when s.sealed then null else g.city2 end,
    case when s.sealed then null else g.city3 end,
    g.updated_at, s.sealed
  from public.guesses g
  cross join lateral (select now() < public.round_deadline(g.air_date) as sealed) s
  order by g.air_date desc, g.created_at
$$;

create or replace function public.submit_guess(p_player text, p_city1 text, p_city2 text, p_city3 text)
returns date language plpgsql volatile security definer set search_path = '' as $$
declare
  v_date date := public.current_round_date();
begin
  insert into public.guesses (air_date, player, city1, city2, city3)
  values (v_date, btrim(p_player), btrim(p_city1), btrim(p_city2), btrim(p_city3))
  on conflict (air_date, lower(btrim(player))) do update
    set city1 = excluded.city1, city2 = excluded.city2, city3 = excluded.city3, updated_at = now();
  return v_date;
end $$;

create or replace function public.admin_ok(p_password text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_secrets
    where key = 'admin_password' and value = extensions.crypt(p_password, value)
  )
$$;

create or replace function public.admin_set_answers(p_password text, p_air_date date, p_a1 text, p_a2 text, p_a3 text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.admin_ok(p_password) then raise exception 'Fel lösenord' using errcode = '28P01'; end if;
  insert into public.rounds (air_date, answer1, answer2, answer3)
  values (p_air_date, nullif(btrim(p_a1), ''), nullif(btrim(p_a2), ''), nullif(btrim(p_a3), ''))
  on conflict (air_date) do update
    set answer1 = excluded.answer1, answer2 = excluded.answer2, answer3 = excluded.answer3, updated_at = now();
end $$;

create or replace function public.admin_delete_guess(p_password text, p_id bigint)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.admin_ok(p_password) then raise exception 'Fel lösenord' using errcode = '28P01'; end if;
  delete from public.guesses where id = p_id;
end $$;

create or replace function public.admin_list_guesses(p_password text)
returns setof public.guesses language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.admin_ok(p_password) then raise exception 'Fel lösenord' using errcode = '28P01'; end if;
  return query select * from public.guesses order by air_date desc, created_at;
end $$;

-- Set the admin password (run once, manually, with your own password):
-- insert into public.app_secrets (key, value)
-- values ('admin_password', extensions.crypt('your-password', extensions.gen_salt('bf')))
-- on conflict (key) do update set value = excluded.value;
