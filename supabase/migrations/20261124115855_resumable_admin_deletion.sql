begin;

create table public.system_admin_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('account', 'game')),
  subject_id uuid not null,
  objects jsonb not null default '[]'::jsonb check (jsonb_typeof(objects) = 'array'),
  stage text not null default 'storage' check (stage in ('storage', 'auth', 'complete')),
  created_at timestamptz not null default clock_timestamp(),
  unique (kind, subject_id)
);
alter table public.system_admin_deletion_jobs enable row level security;
revoke all on public.system_admin_deletion_jobs from public, anon, authenticated;
grant select, update on public.system_admin_deletion_jobs to service_role;

create or replace function public.system_admin_start_deletion(
  p_actor_user_id uuid, p_kind text, p_subject_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job_id uuid;
  v_organizer_id uuid;
  v_objects jsonb;
begin
  if not exists (select 1 from public.system_admins where user_id = p_actor_user_id) then
    raise exception 'System administrator access required';
  end if;
  if p_kind not in ('account', 'game') or p_kind is null or p_subject_id is null then
    raise exception 'Invalid deletion target';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_kind || ':' || p_subject_id::text, 0));
  select id into v_job_id from public.system_admin_deletion_jobs
    where kind = p_kind and subject_id = p_subject_id;
  if found then return v_job_id; end if;

  if p_kind = 'account' then
    perform 1 from auth.users where id = p_subject_id and not coalesce(is_anonymous, false) for update;
    if not found then raise exception 'Organizer account not found'; end if;
    select id into v_organizer_id from public.organizers where auth_user_id = p_subject_id for update;
    perform 1 from public.hunts h where h.organizer_id = v_organizer_id or exists (
      select 1 from public.participants p where p.hunt_id = h.id and p.auth_user_id = p_subject_id
    ) order by h.id for update;
    v_objects := public.system_admin_storage_objects(p_subject_id, null);
  else
    perform 1 from public.hunts where id = p_subject_id for update;
    if not found then raise exception 'Game not found'; end if;
    v_objects := public.system_admin_storage_objects(null, p_subject_id);
  end if;

  -- Store the complete inventory in the same transaction that detaches game
  -- references. The Edge Function can only see the job after that commits.
  insert into public.system_admin_deletion_jobs(kind, subject_id, objects)
    values (p_kind, p_subject_id, v_objects) returning id into v_job_id;

  if p_kind = 'account' then
    perform public.system_admin_prepare_account_deletion(p_actor_user_id, p_subject_id, v_objects);
  else
    perform public.system_admin_delete_game(p_actor_user_id, p_subject_id);
  end if;
  return v_job_id;
end;
$$;
revoke all on function public.system_admin_start_deletion(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.system_admin_start_deletion(uuid, text, uuid) to service_role;

-- A previously issued token cannot recreate an organizer or join a new team
-- while the account's Storage/Auth cleanup is pending.
create or replace function public.reject_deleting_account_memberships() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.auth_user_id is null then return new; end if;
  perform 1 from auth.users where id = new.auth_user_id for key share;
  if exists (
    select 1 from public.system_admin_deletion_jobs
    where kind = 'account' and subject_id = new.auth_user_id
  ) then
    raise exception 'This account is being removed';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_deleting_account_memberships() from public, anon, authenticated;
create trigger prevent_organizer_recreation_during_deletion before insert on public.organizers
  for each row execute function public.reject_deleting_account_memberships();
create trigger prevent_new_membership_during_deletion before insert or update of auth_user_id on public.participants
  for each row execute function public.reject_deleting_account_memberships();

-- Serialize uploads with deletion's inventory and reject an upload if its
-- account or game was removed while the Storage request waited on a lock.
create or replace function public.hunt_upload_target_exists(p_path text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_hunt uuid;
begin
  v_hunt := split_part(p_path, '/', 1)::uuid;
  perform 1 from auth.users where id = v_user for key share;
  if not found or exists (
    select 1 from public.system_admin_deletion_jobs where kind = 'account' and subject_id = v_user
  ) then
    return false;
  end if;
  perform 1 from public.hunts where id = v_hunt for key share;
  return found;
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.hunt_upload_target_exists(text) from public, anon;
grant execute on function public.hunt_upload_target_exists(text) to authenticated;

create policy "Hunt media uploads require an existing account and game" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id not in ('hunt-photos', 'winner-cards') or public.hunt_upload_target_exists(name));

commit;
