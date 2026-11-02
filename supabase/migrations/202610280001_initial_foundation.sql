-- Phase 1 foundation: organizer identity and private organizer-owned library.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.organizers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.library_items (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizers(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  category text check (category is null or char_length(category) <= 80),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists library_items_organizer_idx on public.library_items(organizer_id, archived, created_at desc);

alter table public.organizers enable row level security;
alter table public.library_items enable row level security;

drop policy if exists "Organizers can read their own profile" on public.organizers;
drop policy if exists "Organizers can create their own profile" on public.organizers;
drop policy if exists "Organizers can update their own profile" on public.organizers;
drop policy if exists "Organizers manage their library" on public.library_items;

create policy "Organizers can read their own profile" on public.organizers
  for select to authenticated using (auth.uid() = auth_user_id);

create policy "Organizers manage their library" on public.library_items
  for all to authenticated
  using (exists (select 1 from public.organizers o where o.id = organizer_id and o.auth_user_id = auth.uid()))
  with check (exists (select 1 from public.organizers o where o.id = organizer_id and o.auth_user_id = auth.uid()));

-- Organizer profiles are provisioned by a trusted administrator only. Authenticated
-- users cannot grant themselves organizer access from the client.
grant select on public.organizers to authenticated;
grant select, insert, update, delete on public.library_items to authenticated;
