-- A system-owned organizer keeps published community templates and completed
-- games when a person's organizer account is removed.
begin;

alter table public.organizers
  alter column auth_user_id drop not null,
  add column if not exists is_system_profile boolean not null default false;

alter table public.organizers
  drop constraint if exists organizers_system_identity_check;
alter table public.organizers
  add constraint organizers_system_identity_check
  check ((is_system_profile and auth_user_id is null) or (not is_system_profile and auth_user_id is not null));

create unique index if not exists organizers_single_system_profile_idx
  on public.organizers(is_system_profile) where is_system_profile;

insert into public.organizers(auth_user_id, is_system_profile)
values (null, true)
on conflict do nothing;

insert into public.hunt_creator_profiles(organizer_id, display_name)
select id, 'SnapQuest Community'
from public.organizers
where is_system_profile
on conflict (organizer_id) do update set display_name = excluded.display_name;

-- Keep a deleted account's historical participant row, but remove its Auth
-- identity so deleting auth.users does not erase hunt history.
alter table public.participants
  alter column auth_user_id drop not null;
alter table public.participants
  drop constraint if exists participants_auth_user_id_fkey;
alter table public.participants
  add constraint participants_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete set null;

-- Admin membership and audit data are accessed only by the trusted Edge Function.
create table if not exists public.system_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.system_admin_action_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('delete_user', 'delete_template', 'delete_game')),
  subject_type text not null check (subject_type in ('auth_user', 'hunt_template', 'game')),
  subject_id uuid not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists system_admin_action_log_created_idx
  on public.system_admin_action_log(created_at desc);

alter table public.system_admins enable row level security;
alter table public.system_admin_action_log enable row level security;
revoke all on public.system_admins, public.system_admin_action_log from public, anon, authenticated;
grant select, insert, update, delete on public.system_admins, public.system_admin_action_log to service_role;

-- Return Storage object paths only to the server-side admin function. Paths are
-- grouped by bucket and never sent to the browser.
create or replace function public.system_admin_storage_objects(
  p_user_id uuid default null,
  p_hunt_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (p_user_id is null) = (p_hunt_id is null) then
    raise exception 'Provide exactly one account or game identifier';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('bucket_id', o.bucket_id, 'name', o.name) order by o.bucket_id, o.name)
    from storage.objects o
    where (p_user_id is not null and o.owner_id = p_user_id::text)
       or (p_hunt_id is not null and o.name like p_hunt_id::text || '/%')
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.system_admin_storage_objects(uuid, uuid) from public, anon, authenticated;
grant execute on function public.system_admin_storage_objects(uuid, uuid) to service_role;

create or replace function public.system_admin_prepare_account_deletion(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_owned_objects jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizer_id uuid;
  v_community_organizer_id uuid;
  v_community_creator_id uuid;
  v_public_templates integer := 0;
  v_private_templates integer := 0;
  v_draft_games integer := 0;
  v_preserved_games integer := 0;
  v_participants integer := 0;
  v_messages integer := 0;
  v_submissions integer := 0;
  v_selfies integer := 0;
  v_winner_cards integer := 0;
begin
  if not exists (select 1 from public.system_admins a where a.user_id = p_actor_user_id) then
    raise exception 'System administrator access required';
  end if;
  if p_actor_user_id = p_target_user_id then
    raise exception 'Administrators cannot delete their own account';
  end if;
  if exists (select 1 from public.system_admins a where a.user_id = p_target_user_id) then
    raise exception 'Remove system administrator access before deleting this account';
  end if;
  if jsonb_typeof(coalesce(p_owned_objects, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid account Storage inventory';
  end if;

  select id into v_community_organizer_id
  from public.organizers
  where is_system_profile
  for update;
  select id into v_community_creator_id
  from public.hunt_creator_profiles
  where organizer_id = v_community_organizer_id;
  if v_community_organizer_id is null or v_community_creator_id is null then
    raise exception 'SnapQuest Community profile is unavailable';
  end if;

  select id into v_organizer_id
  from public.organizers
  where auth_user_id = p_target_user_id
  for update;

  if v_organizer_id is not null and exists (
    select 1 from public.hunts h
    where h.organizer_id = v_organizer_id
      and h.status in ('scheduled', 'active', 'review')
  ) then
    raise exception 'Resolve scheduled, active, or review hunts before deleting this account';
  end if;

  if v_organizer_id is not null then
    update public.hunt_templates
      set organizer_id = v_community_organizer_id,
          creator_profile_id = v_community_creator_id
      where organizer_id = v_organizer_id and visibility = 'public';
    get diagnostics v_public_templates = row_count;

    delete from public.hunt_templates
    where organizer_id = v_organizer_id and visibility = 'personal';
    get diagnostics v_private_templates = row_count;

    delete from public.hunts
    where organizer_id = v_organizer_id and status = 'draft';
    get diagnostics v_draft_games = row_count;

    update public.hunts
      set organizer_id = v_community_organizer_id,
          template_snapshot = case
            when template_snapshot is null then null
            else jsonb_set(
              jsonb_set(template_snapshot, '{creatorId}', to_jsonb(v_community_creator_id::text), true),
              '{creatorName}', '"SnapQuest Community"'::jsonb, true
            )
          end
      where organizer_id = v_organizer_id and status in ('completed', 'archived');
    get diagnostics v_preserved_games = row_count;

    delete from public.hunt_creator_profiles where organizer_id = v_organizer_id;
    delete from public.organizers where id = v_organizer_id;
  end if;

  -- Remove rows that point to media owned by the account before the server
  -- deletes those Storage objects. Finalized score snapshots stay on the game.
  delete from public.submissions s
  where exists (
    select 1 from jsonb_array_elements(coalesce(p_owned_objects, '[]'::jsonb)) o
    where o->>'bucket_id' = 'hunt-photos' and o->>'name' = s.storage_path
  );
  get diagnostics v_submissions = row_count;

  delete from public.team_selfies s
  where exists (
    select 1 from jsonb_array_elements(coalesce(p_owned_objects, '[]'::jsonb)) o
    where o->>'bucket_id' = 'hunt-photos' and o->>'name' = s.storage_path
  );
  get diagnostics v_selfies = row_count;

  delete from public.winner_celebration_cards c
  where exists (
    select 1 from jsonb_array_elements(coalesce(p_owned_objects, '[]'::jsonb)) o
    where o->>'bucket_id' = 'winner-cards' and o->>'name' = c.storage_path
  );
  get diagnostics v_winner_cards = row_count;

  update public.participants
    set auth_user_id = null, display_name = 'Former player'
    where auth_user_id = p_target_user_id;
  get diagnostics v_participants = row_count;

  delete from public.hunt_messages where sender_user_id = p_target_user_id;
  get diagnostics v_messages = row_count;

  insert into public.system_admin_action_log(actor_user_id, action, subject_type, subject_id, details)
  values (
    p_actor_user_id,
    'delete_user',
    'auth_user',
    p_target_user_id,
    jsonb_build_object(
      'public_templates_transferred', v_public_templates,
      'private_templates_deleted', v_private_templates,
      'draft_games_deleted', v_draft_games,
      'completed_games_preserved', v_preserved_games,
      'participants_anonymized', v_participants,
      'chat_messages_removed', v_messages,
      'submissions_removed', v_submissions,
      'team_selfies_removed', v_selfies,
      'winner_cards_removed', v_winner_cards,
      'owned_storage_objects_removed', jsonb_array_length(coalesce(p_owned_objects, '[]'::jsonb))
    )
  );

  return jsonb_build_object(
    'public_templates_transferred', v_public_templates,
    'private_templates_deleted', v_private_templates,
    'draft_games_deleted', v_draft_games,
    'completed_games_preserved', v_preserved_games,
    'participants_anonymized', v_participants,
    'chat_messages_removed', v_messages,
    'submissions_removed', v_submissions,
    'team_selfies_removed', v_selfies,
    'winner_cards_removed', v_winner_cards
  );
end;
$$;
revoke all on function public.system_admin_prepare_account_deletion(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.system_admin_prepare_account_deletion(uuid, uuid, jsonb) to service_role;

create or replace function public.system_admin_delete_template(p_actor_user_id uuid, p_template_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_title text;
begin
  if not exists (select 1 from public.system_admins a where a.user_id = p_actor_user_id) then
    raise exception 'System administrator access required';
  end if;
  delete from public.hunt_templates where id = p_template_id returning title into v_title;
  if v_title is null then raise exception 'Hunt template not found'; end if;
  insert into public.system_admin_action_log(actor_user_id, action, subject_type, subject_id, details)
  values (p_actor_user_id, 'delete_template', 'hunt_template', p_template_id, jsonb_build_object('title', v_title));
  return v_title;
end;
$$;
revoke all on function public.system_admin_delete_template(uuid, uuid) from public, anon, authenticated;
grant execute on function public.system_admin_delete_template(uuid, uuid) to service_role;

create or replace function public.system_admin_delete_game(p_actor_user_id uuid, p_hunt_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_title text;
begin
  if not exists (select 1 from public.system_admins a where a.user_id = p_actor_user_id) then
    raise exception 'System administrator access required';
  end if;
  delete from public.hunts where id = p_hunt_id returning title into v_title;
  if v_title is null then raise exception 'Game not found'; end if;
  insert into public.system_admin_action_log(actor_user_id, action, subject_type, subject_id, details)
  values (p_actor_user_id, 'delete_game', 'game', p_hunt_id, jsonb_build_object('title', v_title));
  return v_title;
end;
$$;
revoke all on function public.system_admin_delete_game(uuid, uuid) from public, anon, authenticated;
grant execute on function public.system_admin_delete_game(uuid, uuid) to service_role;

commit;
