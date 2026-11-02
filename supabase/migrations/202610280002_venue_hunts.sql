-- Phase 2 foundation: venue-based draft hunts, suggested rules, and item lists.
create table if not exists public.hunts (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizers(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  venue text not null check (char_length(trim(venue)) between 1 and 160),
  description text check (description is null or char_length(description) <= 1000),
  rules text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','scheduled','active','review','completed','archived')),
  start_at timestamptz,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 1440),
  team_assignment_mode text not null default 'organizer' check (team_assignment_mode in ('organizer','balanced')),
  voting_enabled boolean not null default false,
  voting_bonus_points integer not null default 0 check (voting_bonus_points >= 0),
  created_at timestamptz not null default now(),
  check (start_at is null or start_at > created_at)
);

create index if not exists hunts_organizer_created_idx on public.hunts(organizer_id, created_at desc);

create table if not exists public.hunt_items (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts(id) on delete cascade,
  library_item_id uuid references public.library_items(id) on delete set null,
  title_snapshot text not null check (char_length(trim(title_snapshot)) between 1 and 120),
  description_snapshot text check (description_snapshot is null or char_length(description_snapshot) <= 1000),
  point_value integer not null default 1 check (point_value between 0 and 1000),
  display_order integer not null check (display_order >= 0),
  created_at timestamptz not null default now(),
  unique (hunt_id, display_order)
);

create index if not exists hunt_items_hunt_order_idx on public.hunt_items(hunt_id, display_order);

alter table public.hunts enable row level security;
alter table public.hunt_items enable row level security;

drop policy if exists "Organizers manage their hunts" on public.hunts;
drop policy if exists "Organizers manage items in their hunts" on public.hunt_items;

create policy "Organizers manage their hunts" on public.hunts
  for all to authenticated
  using (exists (select 1 from public.organizers o where o.id = organizer_id and o.auth_user_id = auth.uid()))
  with check (exists (select 1 from public.organizers o where o.id = organizer_id and o.auth_user_id = auth.uid()));

create policy "Organizers manage items in their hunts" on public.hunt_items
  for all to authenticated
  using (exists (
    select 1 from public.hunts h
    join public.organizers o on o.id = h.organizer_id
    where h.id = hunt_id and o.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.hunts h
    join public.organizers o on o.id = h.organizer_id
    where h.id = hunt_id and o.auth_user_id = auth.uid()
  ));

grant select, insert, update, delete on public.hunts to authenticated;
grant select, insert, update, delete on public.hunt_items to authenticated;

-- Create a draft, its reusable library entries, and item snapshots as one transaction.
create or replace function public.create_hunt_draft(
  p_title text,
  p_venue text,
  p_rules text[],
  p_items jsonb,
  p_duration_minutes integer default 60
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_organizer_id uuid;
  v_hunt_id uuid;
  v_library_item_id uuid;
  v_item jsonb;
  v_title text;
  v_description text;
  v_point_value integer;
  v_order integer := 0;
begin
  select id into v_organizer_id
  from public.organizers
  where auth_user_id = auth.uid();

  if v_organizer_id is null then
    raise exception 'Organizer profile required';
  end if;
  if char_length(trim(coalesce(p_venue, ''))) not between 1 and 160 then
    raise exception 'Enter a venue name (up to 160 characters)';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Enter a hunt title (up to 120 characters)';
  end if;
  if coalesce(jsonb_typeof(p_items), 'null') <> 'array' then
    raise exception 'Add between 1 and 100 photo challenges';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Add between 1 and 100 photo challenges';
  end if;
  if p_duration_minutes not between 5 and 1440 then
    raise exception 'Duration must be between 5 minutes and 24 hours';
  end if;

  insert into public.hunts(organizer_id, title, venue, rules, duration_minutes)
  values (v_organizer_id, trim(p_title), trim(p_venue), coalesce(p_rules, '{}'), p_duration_minutes)
  returning id into v_hunt_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_title := trim(coalesce(v_item->>'title', ''));
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_point_value := coalesce(nullif(v_item->>'pointValue', '')::integer, 1);
    if char_length(v_title) not between 1 and 120 then
      raise exception 'Each challenge needs a name (up to 120 characters)';
    end if;
    if v_point_value not between 0 and 1000 then
      raise exception 'Point values must be between 0 and 1000';
    end if;

    insert into public.library_items(organizer_id, title, description)
    values (v_organizer_id, v_title, v_description)
    returning id into v_library_item_id;

    insert into public.hunt_items(hunt_id, library_item_id, title_snapshot, description_snapshot, point_value, display_order)
    values (v_hunt_id, v_library_item_id, v_title, v_description, v_point_value, v_order);
    v_order := v_order + 1;
  end loop;

  return v_hunt_id;
end;
$$;

revoke all on function public.create_hunt_draft(text, text, text[], jsonb, integer) from public;
grant execute on function public.create_hunt_draft(text, text, text[], jsonb, integer) to authenticated;
