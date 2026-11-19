begin;

-- Winner cards are generated in the organizer's browser and stored privately
-- so completed hunts can reopen the same celebration later.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('winner-cards', 'winner-cards', false, 2097152, array['image/png'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.winner_celebration_cards (
  hunt_id uuid not null references public.hunts(id) on delete cascade,
  team_id uuid not null,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  primary key (hunt_id, team_id),
  foreign key (team_id, hunt_id) references public.teams(id, hunt_id) on delete cascade,
  check (storage_path = hunt_id::text || '/' || team_id::text || '/winner.png')
);

alter table public.winner_celebration_cards enable row level security;
revoke all on public.winner_celebration_cards from public, anon;
grant select, insert, update on public.winner_celebration_cards to authenticated;

drop policy if exists "Organizers read their saved winner cards" on public.winner_celebration_cards;
create policy "Organizers read their saved winner cards" on public.winner_celebration_cards
  for select to authenticated
  using (public.is_hunt_organizer(hunt_id));

drop policy if exists "Organizers save winner cards for completed hunts" on public.winner_celebration_cards;
create policy "Organizers save winner cards for completed hunts" on public.winner_celebration_cards
  for insert to authenticated
  with check (
    public.is_hunt_organizer(hunt_id)
    and exists (select 1 from public.hunts h where h.id = hunt_id and h.status = 'completed')
  );

drop policy if exists "Organizers update their saved winner cards" on public.winner_celebration_cards;
create policy "Organizers update their saved winner cards" on public.winner_celebration_cards
  for update to authenticated
  using (public.is_hunt_organizer(hunt_id))
  with check (
    public.is_hunt_organizer(hunt_id)
    and exists (select 1 from public.hunts h where h.id = hunt_id and h.status = 'completed')
  );

create or replace function public.can_manage_winner_card(p_path text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hunt_id uuid;
  v_team_id uuid;
begin
  if auth.uid() is null or array_length(string_to_array(p_path, '/'), 1) <> 3
     or split_part(p_path, '/', 3) <> 'winner.png' then return false; end if;
  v_hunt_id := split_part(p_path, '/', 1)::uuid;
  v_team_id := split_part(p_path, '/', 2)::uuid;
  return exists (
    select 1 from public.hunts h
    join public.teams t on t.hunt_id = h.id
    where h.id = v_hunt_id and t.id = v_team_id and h.status = 'completed'
      and public.is_hunt_organizer(h.id)
  );
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.can_manage_winner_card(text) from public, anon;
grant execute on function public.can_manage_winner_card(text) to authenticated;

drop policy if exists "Organizers read saved winner card images" on storage.objects;
create policy "Organizers read saved winner card images" on storage.objects
  for select to authenticated
  using (bucket_id = 'winner-cards' and public.can_manage_winner_card(name));

drop policy if exists "Organizers save winner card images" on storage.objects;
create policy "Organizers save winner card images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'winner-cards' and public.can_manage_winner_card(name));

drop policy if exists "Organizers update winner card images" on storage.objects;
create policy "Organizers update winner card images" on storage.objects
  for update to authenticated
  using (bucket_id = 'winner-cards' and public.can_manage_winner_card(name))
  with check (bucket_id = 'winner-cards' and public.can_manage_winner_card(name));

drop policy if exists "Organizers remove winner card images" on storage.objects;
create policy "Organizers remove winner card images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'winner-cards' and public.can_manage_winner_card(name));

notify pgrst, 'reload schema';
commit;
