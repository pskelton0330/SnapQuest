begin;

-- Use a composite keyset cursor so equally-timestamped messages are never skipped.
drop function if exists public.get_hunt_messages(uuid, integer, timestamptz);
drop function if exists public.get_hunt_messages(uuid, integer);

create function public.get_hunt_messages(
  p_hunt_id uuid,
  p_limit integer default 101,
  p_before timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_messages jsonb;
begin
  if auth.uid() is null or not (public.is_hunt_organizer(p_hunt_id) or public.is_hunt_participant(p_hunt_id)) then
    raise exception 'Hunt access required';
  end if;
  select * into v_hunt from public.hunts where id = p_hunt_id;
  if v_hunt.status in ('draft','archived') then raise exception 'Chat is not open for this hunt'; end if;
  if (p_before is null) <> (p_before_id is null) then raise exception 'Both chat cursor values are required'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'sender_name',m.sender_name,'sender_role',m.sender_role,'body',m.body,'created_at',m.created_at
  ) order by m.created_at,m.id),'[]'::jsonb)
  into v_messages
  from (
    select * from public.hunt_messages
    where hunt_id=p_hunt_id
      and (p_before is null or (created_at,id)<(p_before,p_before_id))
    order by created_at desc,id desc
    limit greatest(1,least(coalesce(p_limit,101),101))
  ) m;
  return v_messages;
end;
$$;

revoke all on function public.get_hunt_messages(uuid,integer,timestamptz,uuid) from public;
grant execute on function public.get_hunt_messages(uuid,integer,timestamptz,uuid) to authenticated;

commit;
