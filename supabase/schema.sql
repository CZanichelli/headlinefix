-- HeadlineFix schema. Paste into the Supabase SQL editor and run.

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_created_idx
  on public.usage_events (user_id, created_at);

alter table public.usage_events enable row level security;

drop policy if exists "Users can select own usage" on public.usage_events;
create policy "Users can select own usage"
  on public.usage_events for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Counts the caller's rewrites this calendar month (UTC). SECURITY DEFINER so the
-- insert policy below can read the table without re-triggering RLS (which recurses).
create or replace function public.usage_this_month()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.usage_events
  where user_id = (select auth.uid())
    and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;

revoke execute on function public.usage_this_month() from public, anon;
grant execute on function public.usage_this_month() to authenticated;

-- Insert only for yourself, and only while under 20 rewrites this calendar month.
drop policy if exists "Users can insert own usage" on public.usage_events;
create policy "Users can insert own usage"
  on public.usage_events for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.usage_this_month() < 20
  );
