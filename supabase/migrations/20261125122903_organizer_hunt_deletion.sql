begin;

alter table public.system_admin_deletion_jobs
  add column organizer_user_id uuid references auth.users(id) on delete set null,
  add column hunt_title text,
  add constraint organizer_deletion_is_hunt_check
    check (organizer_user_id is null or kind = 'game');

create index deletion_jobs_organizer_idx on public.system_admin_deletion_jobs(organizer_user_id, created_at)
  where organizer_user_id is not null;

-- The Edge Function supplies the verified account ID. Ordinary API roles
-- cannot stage a deletion or inspect the media inventory.
create or replace function public.organizer_start_hunt_deletion(
  p_actor_user_id uuid, p_hunt_id uuid, p_confirmation text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.system_admin_deletion_jobs%rowtype;
  v_title text;
  v_objects jsonb;
begin
  perform 1 from auth.users
    where id = p_actor_user_id and email_confirmed_at is not null and not coalesce(is_anonymous, false)
    for key share;
  if not found then raise sqlstate 'PT403' using message = 'Verified organizer access required'; end if;
  if p_hunt_id is null then raise sqlstate 'PT404' using message = 'Hunt not found'; end if;

  -- Match the admin worker lock, and lock the hunt before taking inventory so
  -- no new upload can slip between inventory and database deletion.
  perform pg_advisory_xact_lock(hashtextextended('game:' || p_hunt_id::text, 0));
  select * into v_job from public.system_admin_deletion_jobs
    where kind = 'game' and subject_id = p_hunt_id;
  if found then
    if v_job.organizer_user_id is distinct from p_actor_user_id then
      raise sqlstate 'PT404' using message = 'Hunt not found';
    end if;
    return v_job.id;
  end if;

  select h.title into v_title from public.hunts h
    join public.organizers o on o.id = h.organizer_id
    where h.id = p_hunt_id and o.auth_user_id = p_actor_user_id
    for update of h;
  if not found then raise sqlstate 'PT404' using message = 'Hunt not found'; end if;
  if p_confirmation is distinct from v_title then
    raise sqlstate 'PT400' using message = 'The hunt name changed. Confirm the deletion again from My Hunts.';
  end if;

  select coalesce(jsonb_agg(object), '[]'::jsonb) into v_objects
  from jsonb_array_elements(public.system_admin_storage_objects(null, p_hunt_id)) as object
  where object->>'bucket_id' in ('hunt-photos', 'winner-cards');

  insert into public.system_admin_deletion_jobs(kind, subject_id, objects, organizer_user_id, hunt_title)
    values ('game', p_hunt_id, v_objects, p_actor_user_id, v_title)
    returning id into v_job.id;
  delete from public.hunts where id = p_hunt_id;

  insert into public.audit_events(actor_user_id, event_type, outcome, details)
    values (p_actor_user_id, 'hunt_deletion_started', 'success', jsonb_build_object('deletion_job_id', v_job.id));
  return v_job.id;
end;
$$;
revoke all on function public.organizer_start_hunt_deletion(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.organizer_start_hunt_deletion(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
