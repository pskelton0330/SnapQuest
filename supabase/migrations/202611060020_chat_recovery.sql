begin;

create or replace function public.get_hunt_messages(
  p_hunt_id uuid,
  p_limit integer,
  p_before timestamptz
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_messages jsonb;
begin
  if auth.uid() is null or not (public.is_hunt_organizer(p_hunt_id) or public.is_hunt_participant(p_hunt_id)) then
    raise exception 'Hunt access required';
  end if;
  select * into v_hunt from public.hunts where id = p_hunt_id;
  if v_hunt.status in ('draft','archived') then raise exception 'Chat is not open for this hunt'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'sender_name',m.sender_name,'sender_role',m.sender_role,'body',m.body,'created_at',m.created_at) order by m.created_at,m.id),'[]'::jsonb)
    into v_messages
  from (select * from public.hunt_messages where hunt_id=p_hunt_id and (p_before is null or created_at<p_before)
    order by created_at desc,id desc limit greatest(1,least(coalesce(p_limit,100),100))) m;
  return v_messages;
end;
$$;
revoke all on function public.get_hunt_messages(uuid,integer,timestamptz) from public;
grant execute on function public.get_hunt_messages(uuid,integer,timestamptz) to authenticated;

create or replace function public.send_hunt_message(p_hunt_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_participant public.participants%rowtype; v_name text; v_role text; v_message public.hunt_messages%rowtype; v_recent integer;
begin
  if auth.uid() is null then raise exception 'A signed-in hunt session is required'; end if;
  if char_length(trim(coalesce(p_body,''))) not between 1 and 500 then raise exception 'Messages must contain 1 to 500 characters'; end if;
  select * into v_hunt from public.hunts where id=p_hunt_id for update;
  if not found or v_hunt.status not in ('scheduled','active') then raise exception 'Chat is only open before or during the hunt'; end if;
  select count(*)::integer into v_recent from public.hunt_messages
    where hunt_id=p_hunt_id and sender_user_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute';
  if v_recent >= 8 then raise exception 'You have sent several messages. Wait a minute before sending another.'; end if;
  if public.is_hunt_organizer(p_hunt_id) then
    v_role := 'organizer';
    select coalesce(cp.display_name,'Organizer') into v_name
    from public.organizers o left join public.hunt_creator_profiles cp on cp.organizer_id=o.id
    where o.auth_user_id=auth.uid() and o.id=v_hunt.organizer_id;
    v_name := coalesce(v_name,'Organizer');
  else
    v_role := 'participant';
    select * into v_participant from public.participants where hunt_id=p_hunt_id and auth_user_id=auth.uid();
    if not found then raise exception 'Participant access required'; end if;
    v_name := v_participant.display_name;
  end if;
  insert into public.hunt_messages(hunt_id,sender_user_id,sender_participant_id,sender_name,sender_role,body)
    values(p_hunt_id,auth.uid(),v_participant.id,v_name,v_role,trim(p_body)) returning * into v_message;
  return jsonb_build_object('id',v_message.id,'sender_name',v_message.sender_name,'sender_role',v_message.sender_role,'body',v_message.body,'created_at',v_message.created_at);
end;
$$;
revoke all on function public.send_hunt_message(uuid,text) from public;
grant execute on function public.send_hunt_message(uuid,text) to authenticated;

commit;
