-- Ordana widget: sign-in relay and signed-out use counter (see ORDANA_WIDGET.md). Paste into the Supabase SQL
-- editor and run; safe to re-run.
-- The popup's callback parks the finished widget session under its OAuth state; the embed collects it once.
-- No policies: only the two functions below touch the table.

create table if not exists public.ordana_widget_signins (
  state text primary key check (char_length(state) between 16 and 128),
  token text not null check (char_length(token) <= 4096),
  user_info jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.ordana_widget_signins enable row level security;

create or replace function public.ordana_widget_signin_put(p_state text, p_token text, p_user jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.ordana_widget_signins where created_at < now() - interval '10 minutes';
  insert into public.ordana_widget_signins (state, token, user_info)
  values (p_state, p_token, coalesce(p_user, '{}'::jsonb))
  on conflict (state) do nothing;
$$;

-- Returns the parked sign-in once and deletes it.
create or replace function public.ordana_widget_signin_take(p_state text)
returns table (token text, user_info jsonb)
language sql
security definer
set search_path = ''
as $$
  delete from public.ordana_widget_signins
  where state = p_state and created_at > now() - interval '10 minutes'
  returning token, user_info;
$$;

revoke execute on function public.ordana_widget_signin_put(text, text, jsonb) from public;
revoke execute on function public.ordana_widget_signin_take(text) from public;
grant execute on function public.ordana_widget_signin_put(text, text, jsonb) to anon;
grant execute on function public.ordana_widget_signin_take(text) to anon;

-- Signed-out rewrites per anon ref ("3 free tries without an account"). The server takes one before
-- asking Ordana (consume: 1) and gives it back when Ordana says no. Only the two functions touch the table.
create table if not exists public.ordana_widget_anon_uses (
  ref text primary key check (ref ~ '^anon_[A-Za-z0-9-]{8,64}$'),
  uses integer not null default 0 check (uses >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ordana_widget_anon_uses enable row level security;

-- Returns the new count, or null when the ref already used p_limit (nothing is taken then).
create or replace function public.ordana_widget_anon_take(p_ref text, p_limit integer)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.ordana_widget_anon_uses as t (ref, uses) values (p_ref, 1)
  on conflict (ref) do update set uses = t.uses + 1, updated_at = now() where t.uses < p_limit
  returning t.uses;
$$;

create or replace function public.ordana_widget_anon_give_back(p_ref text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ordana_widget_anon_uses set uses = greatest(uses - 1, 0), updated_at = now() where ref = p_ref;
$$;

revoke execute on function public.ordana_widget_anon_take(text, integer) from public;
revoke execute on function public.ordana_widget_anon_give_back(text) from public;
grant execute on function public.ordana_widget_anon_take(text, integer) to anon;
grant execute on function public.ordana_widget_anon_give_back(text) to anon;
