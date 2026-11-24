begin;

-- A library entry is a reusable content snapshot made only when a game first
-- publishes final results. Historical games are not backfilled here.
alter table public.hunt_templates
  add column if not exists completed_game_id uuid,
  add column if not exists is_completed_snapshot boolean not null default false;

alter table public.hunt_templates
  drop constraint if exists hunt_templates_completed_snapshot_check;
alter table public.hunt_templates
  add constraint hunt_templates_completed_snapshot_check
  check (not is_completed_snapshot or (visibility = 'public' and completed_game_id is not null));

create unique index if not exists hunt_templates_completed_game_uidx
  on public.hunt_templates(completed_game_id) where completed_game_id is not null;
create index if not exists hunt_templates_completed_library_idx
  on public.hunt_templates(created_at desc, id)
  where is_completed_snapshot and visibility = 'public';

create or replace function public.hunt_library_document(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'title', t.title, 'description', nullif(t.description, ''),
    'defaultDuration', t.default_duration_minutes, 'rules', t.rules, 'createdAt', t.created_at,
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object('title', i.title, 'description', nullif(i.description, ''),
        'points', i.points, 'displayOrder', i.display_order) order by i.display_order)
      from public.hunt_template_items i where i.template_id = t.id
    ), '[]'::jsonb)
  )
  from public.hunt_templates t
  where t.id = p_id and t.is_completed_snapshot and t.visibility = 'public';
$$;
revoke all on function public.hunt_library_document(uuid) from public, anon, authenticated;

create or replace function public.list_hunt_templates(p_owned boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid;
begin
  select id into v_owner from public.organizers where auth_user_id = auth.uid();
  if p_owned and v_owner is null then raise exception 'Organizer access required'; end if;
  if p_owned then
    return coalesce((select jsonb_agg(public.hunt_template_document(t.id) order by t.created_at desc, t.id)
      from public.hunt_templates t where t.organizer_id = v_owner), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(public.hunt_library_document(t.id) order by t.created_at desc, t.id)
    from public.hunt_templates t where t.is_completed_snapshot and t.visibility = 'public'), '[]'::jsonb);
end;
$$;
revoke all on function public.list_hunt_templates(boolean) from public;
grant execute on function public.list_hunt_templates(boolean) to anon, authenticated;

-- Direct template saves remain private. The final-results transition below is
-- the only application path that can make a template public.
create or replace function public.save_hunt_template(
  p_title text, p_venue text, p_description text, p_rules text[], p_items jsonb,
  p_duration integer default 60, p_visibility text default 'personal', p_template_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_creator uuid; v_id uuid; v_item jsonb; v_order integer := 0;
  v_title text; v_description text; v_points integer;
begin
  select id into v_owner from public.organizers where auth_user_id = auth.uid();
  if v_owner is null then raise exception 'Organizer access required'; end if;
  if p_visibility is distinct from 'personal' then
    raise exception 'A hunt enters the public library after final results are published';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(trim(coalesce(p_venue, ''))) not between 1 and 160
     or p_duration is null or p_duration < 1
     or char_length(coalesce(p_description, '')) > 1000 then raise exception 'Valid hunt details are required'; end if;
  if cardinality(coalesce(p_rules, '{}')) > 30
     or exists(select 1 from unnest(coalesce(p_rules, '{}')) r where r is null or char_length(trim(r)) not between 1 and 1000) then
    raise exception 'Use up to 30 rules, each 1 to 1,000 characters';
  end if;
  if coalesce(jsonb_typeof(p_items), 'null') <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Use 1 to 100 photo challenges';
  end if;
  insert into public.hunt_creator_profiles(organizer_id) values(v_owner) on conflict(organizer_id) do nothing;
  select id into v_creator from public.hunt_creator_profiles where organizer_id = v_owner;
  if p_template_id is null then
    insert into public.hunt_templates(organizer_id, creator_profile_id, title, venue, description, rules, default_duration_minutes, visibility)
    values(v_owner, v_creator, trim(p_title), trim(p_venue), coalesce(p_description, ''), coalesce(p_rules, '{}'), p_duration, 'personal')
    returning id into v_id;
  else
    select id into v_id from public.hunt_templates
      where id = p_template_id and organizer_id = v_owner and visibility = 'personal' and not is_completed_snapshot for update;
    if v_id is null then raise exception 'Only your private hunts can be edited'; end if;
    update public.hunt_templates set title = trim(p_title), venue = trim(p_venue), description = coalesce(p_description, ''),
      rules = coalesce(p_rules, '{}'), default_duration_minutes = p_duration where id = v_id;
    delete from public.hunt_template_items where template_id = v_id;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_title := trim(coalesce(v_item->>'title', ''));
    v_description := coalesce(v_item->>'description', '');
    v_points := coalesce(nullif(v_item->>'points', '')::integer, 1);
    if char_length(v_title) not between 1 and 120 or char_length(v_description) > 1000 or v_points not between 0 and 1000 then
      raise exception 'Each challenge needs a name, description up to 1,000 characters, and 0 to 1,000 points';
    end if;
    insert into public.hunt_template_items(template_id, title, description, points, display_order)
      values(v_id, v_title, v_description, v_points, v_order);
    v_order := v_order + 1;
  end loop;
  return v_id;
end;
$$;
revoke all on function public.save_hunt_template(text, text, text, text[], jsonb, integer, text, uuid) from public;
grant execute on function public.save_hunt_template(text, text, text, text[], jsonb, integer, text, uuid) to authenticated;

create or replace function public.copy_hunt_template(p_template_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_template public.hunt_templates%rowtype; v_owner uuid; v_id uuid;
begin
  select id into v_owner from public.organizers where auth_user_id = auth.uid();
  if v_owner is null then raise exception 'Organizer access required'; end if;
  select * into v_template from public.hunt_templates t where t.id = p_template_id and (
    (t.is_completed_snapshot and t.visibility = 'public') or (t.visibility = 'personal' and t.organizer_id = v_owner)
  ) for share;
  if not found then raise exception 'Hunt not available'; end if;
  v_id := public.save_hunt_template(v_template.title, v_template.venue, v_template.description, v_template.rules,
    (public.hunt_template_document(p_template_id))->'challenges', v_template.default_duration_minutes, 'personal', null);
  return v_id;
end;
$$;
revoke all on function public.copy_hunt_template(uuid) from public;
grant execute on function public.copy_hunt_template(uuid) to authenticated;

create or replace function public.create_game_from_template(p_template_id uuid, p_game_name text default null, p_duration integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_template public.hunt_templates%rowtype; v_id uuid;
begin
  select id into v_owner from public.organizers where auth_user_id = auth.uid();
  if v_owner is null then raise exception 'Organizer access required'; end if;
  select * into v_template from public.hunt_templates t where t.id = p_template_id and (
    (t.is_completed_snapshot and t.visibility = 'public') or (t.visibility = 'personal' and t.organizer_id = v_owner)
  ) for share;
  if not found then raise exception 'Hunt not available'; end if;
  if not exists(select 1 from public.hunt_template_items where template_id = p_template_id) then raise exception 'Hunt has no challenges'; end if;
  if p_duration is not null and p_duration < 1 then raise exception 'Duration must be a positive whole number of minutes'; end if;
  insert into public.hunts(organizer_id, title, venue, description, rules, duration_minutes, template_id, template_snapshot)
  values(v_owner, coalesce(nullif(trim(p_game_name), ''), v_template.title), v_template.venue, v_template.description, v_template.rules,
    coalesce(p_duration, v_template.default_duration_minutes), v_template.id, public.hunt_template_document(v_template.id)) returning id into v_id;
  insert into public.hunt_items(hunt_id, title_snapshot, description_snapshot, point_value, display_order)
  select v_id, title, nullif(description, ''), points, display_order from public.hunt_template_items where template_id = p_template_id;
  return v_id;
end;
$$;
revoke all on function public.create_game_from_template(uuid, text, integer) from public;
grant execute on function public.create_game_from_template(uuid, text, integer) to authenticated;

-- Allow only the snapshot publisher to insert or alter an automatically
-- generated public snapshot and its children. Other snapshots are immutable.
create or replace function public.guard_completed_hunt_library_snapshot() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('snapquest.library_snapshot_write', true), '') <> 'on' then
    if tg_table_name = 'hunt_templates' then
      if tg_op = 'UPDATE' and old.is_completed_snapshot and new.is_completed_snapshot
         and (to_jsonb(new) - array['organizer_id','creator_profile_id']) =
             (to_jsonb(old) - array['organizer_id','creator_profile_id'])
         and exists (
           select 1 from public.organizers o join public.hunt_creator_profiles c on c.organizer_id = o.id
           where o.is_system_profile and new.organizer_id = o.id and new.creator_profile_id = c.id
         ) then
        return new;
      end if;
      if tg_op = 'DELETE' and old.is_completed_snapshot
         and current_setting('snapquest.withdraw_hunt_template', true) = old.id::text then
        return old;
      end if;
      if (tg_op = 'INSERT' and new.is_completed_snapshot)
         or (tg_op = 'UPDATE' and (old.is_completed_snapshot or new.is_completed_snapshot))
         or (tg_op = 'DELETE' and old.is_completed_snapshot) then
        raise exception 'Completed Hunt Library snapshots are immutable';
      end if;
    elsif exists(select 1 from public.hunt_templates t
      where t.id = coalesce(new.template_id, old.template_id) and t.is_completed_snapshot) then
      raise exception 'Completed Hunt Library challenges are immutable';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.guard_completed_hunt_library_snapshot() from public, anon, authenticated;
drop trigger if exists guard_completed_hunt_library_snapshot on public.hunt_templates;
create trigger guard_completed_hunt_library_snapshot before insert or update or delete on public.hunt_templates
  for each row execute function public.guard_completed_hunt_library_snapshot();
drop trigger if exists guard_completed_hunt_library_item_snapshot on public.hunt_template_items;
create trigger guard_completed_hunt_library_item_snapshot before insert or update or delete on public.hunt_template_items
  for each row execute function public.guard_completed_hunt_library_snapshot();

create or replace function public.snapshot_completed_hunt_for_library() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_creator uuid; v_template_id uuid;
begin
  if old.status is distinct from 'completed' and new.status = 'completed' and new.final_scores is not null
     and exists(select 1 from public.hunt_items i where i.hunt_id = new.id) then
    insert into public.hunt_creator_profiles(organizer_id) values(new.organizer_id) on conflict(organizer_id) do nothing;
    select id into v_creator from public.hunt_creator_profiles where organizer_id = new.organizer_id;
    perform set_config('snapquest.library_snapshot_write', 'on', true);
    insert into public.hunt_templates(organizer_id, creator_profile_id, title, venue, description, rules,
      default_duration_minutes, visibility, completed_game_id, is_completed_snapshot)
    values(new.organizer_id, v_creator, new.title, 'Choose a venue', coalesce(new.description, ''),
      coalesce(new.rules, '{}'), new.duration_minutes, 'public', new.id, true)
    on conflict (completed_game_id) where completed_game_id is not null do nothing
    returning id into v_template_id;
    if v_template_id is null then
      select id into v_template_id from public.hunt_templates where completed_game_id = new.id;
    else
      insert into public.hunt_template_items(template_id, title, description, points, display_order)
      select v_template_id, i.title_snapshot, coalesce(i.description_snapshot, ''), i.point_value, i.display_order
      from public.hunt_items i where i.hunt_id = new.id order by i.display_order
      on conflict(template_id, display_order) do nothing;
    end if;
    perform set_config('snapquest.library_snapshot_write', 'off', true);
  end if;
  return new;
end;
$$;
revoke all on function public.snapshot_completed_hunt_for_library() from public, anon, authenticated;
drop trigger if exists publish_completed_hunt_to_library on public.hunts;
create trigger publish_completed_hunt_to_library after update of status on public.hunts
  for each row execute function public.snapshot_completed_hunt_for_library();

create table if not exists public.hunt_draft_requests (
  organizer_id uuid not null references public.organizers(id) on delete cascade,
  request_id uuid not null,
  draft_id uuid not null references public.hunts(id) on delete cascade,
  kind text not null check (kind in ('copy', 'replay')),
  source_id uuid not null,
  primary key (organizer_id, request_id)
);
alter table public.hunt_draft_requests enable row level security;
revoke all on public.hunt_draft_requests from public, anon, authenticated;
create index if not exists hunt_draft_requests_draft_idx on public.hunt_draft_requests(draft_id);

create or replace function public.copy_hunt_library_to_draft(p_template_id uuid, p_request_id uuid default gen_random_uuid()) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_template public.hunt_templates%rowtype; v_hunt_id uuid; v_request public.hunt_draft_requests%rowtype;
begin
  select id into v_owner from public.organizers where auth_user_id = auth.uid();
  if v_owner is null then raise exception 'Organizer access required'; end if;
  if p_request_id is null then raise exception 'A request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_request_id::text, 0));
  select * into v_request from public.hunt_draft_requests
    where organizer_id = v_owner and request_id = p_request_id;
  if found then
    if v_request.kind <> 'copy' or v_request.source_id is distinct from p_template_id then
      raise exception 'This request ID was already used for another hunt';
    end if;
    return v_request.draft_id;
  end if;
  select * into v_template from public.hunt_templates t
    where t.id = p_template_id and t.is_completed_snapshot and t.visibility = 'public' for share;
  if not found then raise exception 'Hunt not available'; end if;
  if not exists(select 1 from public.hunt_template_items where template_id = v_template.id) then raise exception 'Hunt has no challenges'; end if;
  insert into public.hunts(organizer_id, title, venue, description, rules, duration_minutes, template_id, template_snapshot)
  values(v_owner, v_template.title, 'Choose a venue', v_template.description, v_template.rules,
    v_template.default_duration_minutes, v_template.id, public.hunt_library_document(v_template.id)) returning id into v_hunt_id;
  insert into public.hunt_items(hunt_id, title_snapshot, description_snapshot, point_value, display_order)
  select v_hunt_id, title, nullif(description, ''), points, display_order
  from public.hunt_template_items where template_id = v_template.id order by display_order;
  insert into public.hunt_draft_requests(organizer_id, request_id, draft_id, kind, source_id)
    values(v_owner, p_request_id, v_hunt_id, 'copy', p_template_id);
  return v_hunt_id;
end;
$$;
revoke all on function public.copy_hunt_library_to_draft(uuid, uuid) from public;
grant execute on function public.copy_hunt_library_to_draft(uuid, uuid) to authenticated;

create or replace function public.create_hunt_draft_from_game(p_hunt_id uuid, p_request_id uuid default gen_random_uuid()) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_source public.hunts%rowtype; v_hunt_id uuid; v_request public.hunt_draft_requests%rowtype;
begin
  select id into v_owner from public.organizers where auth_user_id = auth.uid();
  if v_owner is null then raise exception 'Organizer access required'; end if;
  if p_request_id is null then raise exception 'A request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_request_id::text, 0));
  select * into v_request from public.hunt_draft_requests
    where organizer_id = v_owner and request_id = p_request_id;
  if found then
    if v_request.kind <> 'replay' or v_request.source_id is distinct from p_hunt_id then
      raise exception 'This request ID was already used for another hunt';
    end if;
    return v_request.draft_id;
  end if;
  select * into v_source from public.hunts h where h.id = p_hunt_id and h.organizer_id = v_owner and h.status = 'completed' for share;
  if not found then raise exception 'Only your completed hunt can be used again'; end if;
  if not exists(select 1 from public.hunt_items where hunt_id = v_source.id) then raise exception 'Hunt has no challenges'; end if;
  insert into public.hunts(organizer_id, title, venue, description, rules, duration_minutes, template_id, template_snapshot)
  values(v_owner, left(v_source.title, 110) || ' (Rematch)', v_source.venue, v_source.description, v_source.rules,
    v_source.duration_minutes, v_source.template_id, v_source.template_snapshot) returning id into v_hunt_id;
  insert into public.hunt_items(hunt_id, title_snapshot, description_snapshot, point_value, display_order)
  select v_hunt_id, title_snapshot, description_snapshot, point_value, display_order
  from public.hunt_items where hunt_id = v_source.id order by display_order;
  insert into public.hunt_draft_requests(organizer_id, request_id, draft_id, kind, source_id)
    values(v_owner, p_request_id, v_hunt_id, 'replay', p_hunt_id);
  return v_hunt_id;
end;
$$;
revoke all on function public.create_hunt_draft_from_game(uuid, uuid) from public;
grant execute on function public.create_hunt_draft_from_game(uuid, uuid) to authenticated;

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
  perform set_config('snapquest.withdraw_hunt_template', p_template_id::text, true);
  delete from public.hunt_templates where id = p_template_id;
  perform set_config('snapquest.withdraw_hunt_template', '', true);

  insert into public.system_admin_action_log(actor_user_id, action, subject_type, subject_id, details)
  values (p_actor_user_id, 'delete_template', 'hunt_template', p_template_id, jsonb_build_object('title', v_title));
  return v_title;
end;
$$;
revoke all on function public.system_admin_delete_template(uuid, uuid) from public, anon, authenticated;
grant execute on function public.system_admin_delete_template(uuid, uuid) to service_role;

create or replace function public.get_organizer_hunt_clock() returns timestamptz
language sql stable security invoker set search_path = '' as $$
  select statement_timestamp();
$$;
revoke all on function public.get_organizer_hunt_clock() from public, anon;
grant execute on function public.get_organizer_hunt_clock() to authenticated;

commit;
