begin;

-- Keep historical games when an organizer's personal template is removed.
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

    delete from public.hunts
    where organizer_id = v_organizer_id and status = 'draft';
    get diagnostics v_draft_games = row_count;

    update public.hunts
      set organizer_id = v_community_organizer_id,
          template_id = case
            when template_id in (
              select t.id from public.hunt_templates t
              where t.organizer_id = v_organizer_id and t.visibility = 'personal'
            ) then null
            else template_id
          end,
          template_snapshot = case
            when template_snapshot is null then null
            else jsonb_set(
              jsonb_set(template_snapshot, '{creatorId}', to_jsonb(v_community_creator_id::text), true),
              '{creatorName}', '"SnapQuest Community"'::jsonb, true
            )
          end
      where organizer_id = v_organizer_id and status in ('completed', 'archived');
    get diagnostics v_preserved_games = row_count;

    delete from public.hunt_templates
    where organizer_id = v_organizer_id and visibility = 'personal';
    get diagnostics v_private_templates = row_count;

    delete from public.hunt_creator_profiles where organizer_id = v_organizer_id;
    delete from public.organizers where id = v_organizer_id;
  end if;

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

-- Games keep their saved snapshot but no longer point at a deleted template.
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

  select title into v_title from public.hunt_templates where id = p_template_id for update;
  if v_title is null then raise exception 'Hunt template not found'; end if;

  update public.hunts set template_id = null where template_id = p_template_id;
  delete from public.hunt_templates where id = p_template_id;

  insert into public.system_admin_action_log(actor_user_id, action, subject_type, subject_id, details)
  values (p_actor_user_id, 'delete_template', 'hunt_template', p_template_id, jsonb_build_object('title', v_title));
  return v_title;
end;
$$;
revoke all on function public.system_admin_delete_template(uuid, uuid) from public, anon, authenticated;
grant execute on function public.system_admin_delete_template(uuid, uuid) to service_role;

commit;
