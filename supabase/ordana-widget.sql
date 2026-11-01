-- Ordana widget: sign-in relay (see ORDANA_WIDGET.md). Paste into the Supabase SQL editor and run.
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
