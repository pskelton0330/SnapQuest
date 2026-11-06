begin;

-- Requiring the version participants saw prevents a stale device from replacing a newer photo.
drop function public.submit_hunt_photo(uuid, text);

create function public.submit_hunt_photo(
  p_hunt_item_id uuid,
  p_storage_path text,
  p_expected_storage_path text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_participant public.participants%rowtype;
  v_hunt public.hunts%rowtype;
  v_item public.hunt_items%rowtype;
  v_old_path text;
  v_has_submission boolean;
  v_now timestamptz;
begin
  if auth.uid() is null then raise exception 'A participant session is required'; end if;
  if array_length(string_to_array(p_storage_path, '/'), 1) <> 4
     or split_part(p_storage_path, '/', 4) !~ '^[0-9a-fA-F-]{36}\.jpg$' then
    raise exception 'The uploaded photo reference is invalid';
  end if;
  select * into v_item from public.hunt_items i where i.id=p_hunt_item_id;
  if not found then raise exception 'This photo challenge is not available'; end if;
  select * into v_participant from public.participants p where p.hunt_id=v_item.hunt_id and p.auth_user_id=auth.uid();
  if not found then raise exception 'You are not a participant in this hunt'; end if;
  if split_part(p_storage_path, '/', 1)::uuid <> v_item.hunt_id
     or split_part(p_storage_path, '/', 2)::uuid <> v_participant.team_id
     or split_part(p_storage_path, '/', 3)::uuid <> v_item.id then
    raise exception 'This photo does not belong to your team and challenge';
  end if;

  select * into v_hunt from public.hunts h where h.id=v_item.hunt_id for update;
  v_now := clock_timestamp();
  if v_hunt.status not in ('scheduled','active') or v_hunt.ended_at is not null
     or v_hunt.start_at is null or v_now < v_hunt.start_at
     or v_now >= v_hunt.start_at + make_interval(mins => v_hunt.duration_minutes) then
    raise exception 'The photo deadline has passed';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id='hunt-photos' and o.name=p_storage_path) then
    raise exception 'The uploaded photo was not found';
  end if;

  select s.storage_path into v_old_path from public.submissions s
  where s.hunt_item_id=v_item.id and s.team_id=v_participant.team_id for update;
  v_has_submission := found;
  if v_has_submission and v_old_path is distinct from p_expected_storage_path then
    raise exception 'A teammate changed this photo slot. Refresh before replacing it again';
  end if;
  if not v_has_submission and p_expected_storage_path is not null then
    raise exception 'This photo slot changed. Refresh before replacing it again';
  end if;

  if v_has_submission then
    update public.submissions set participant_id=v_participant.id,storage_path=p_storage_path,
      submitted_at=v_now,approval_status='pending',reviewed_by=null,reviewed_at=null
    where hunt_item_id=v_item.id and team_id=v_participant.team_id;
  else
    insert into public.submissions(hunt_id,hunt_item_id,team_id,participant_id,storage_path,submitted_at)
    values(v_item.hunt_id,v_item.id,v_participant.team_id,v_participant.id,p_storage_path,v_now);
  end if;
  return jsonb_build_object('accepted',true,'submitted_at',v_now,'previous_storage_path',v_old_path);
end;
$$;
revoke all on function public.submit_hunt_photo(uuid,text,text) from public;
grant execute on function public.submit_hunt_photo(uuid,text,text) to authenticated;

commit;
