-- Phase 3 field experience: private organizer/participant hunt chat.
begin;

create table if not exists public.hunt_messages (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_participant_id uuid references public.participants(id) on delete set null,
  sender_name text not null check (char_length(trim(sender_name)) between 1 and 80),
  sender_role text not null check (sender_role in ('organizer','participant')),
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists hunt_messages_hunt_created_idx on public.hunt_messages(hunt_id, created_at, id);
alter table public.hunt_messages enable row level security;

drop policy if exists "Hunt members read lobby messages" on public.hunt_messages;
create policy "Hunt members read lobby messages" on public.hunt_messages
  for select to authenticated
  using (public.is_hunt_organizer(hunt_id) or public.is_hunt_participant(hunt_id));

grant select on public.hunt_messages to authenticated;
revoke insert, update, delete on public.hunt_messages from authenticated;

create or replace function public.get_hunt_messages(p_hunt_id uuid, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_messages jsonb;
begin
  if auth.uid() is null or not (public.is_hunt_organizer(p_hunt_id) or public.is_hunt_participant(p_hunt_id)) then
    raise exception 'Hunt access required';
  end if;
  select * into v_hunt from public.hunts where id = p_hunt_id;
  if v_hunt.status in ('draft','archived') then raise exception 'Chat is not open for this hunt'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'sender_name',m.sender_name,'sender_role',m.sender_role,'body',m.body,'created_at',m.created_at) order by m.created_at,m.id),'[]'::jsonb)
    into v_messages
  from (select * from public.hunt_messages where hunt_id=p_hunt_id order by created_at desc,id desc limit greatest(1,least(coalesce(p_limit,100),200))) m;
  return v_messages;
end;
$$;
revoke all on function public.get_hunt_messages(uuid,integer) from public;
grant execute on function public.get_hunt_messages(uuid,integer) to authenticated;

create or replace function public.send_hunt_message(p_hunt_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_participant public.participants%rowtype; v_name text; v_role text; v_message public.hunt_messages%rowtype;
begin
  if auth.uid() is null then raise exception 'A signed-in hunt session is required'; end if;
  if char_length(trim(coalesce(p_body,''))) not between 1 and 500 then raise exception 'Messages must contain 1 to 500 characters'; end if;
  select * into v_hunt from public.hunts where id=p_hunt_id for update;
  if not found or v_hunt.status not in ('scheduled','active') then raise exception 'Chat is only open before or during the hunt'; end if;
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

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='hunt_messages') then
    alter publication supabase_realtime add table public.hunt_messages;
  end if;
end $$;

commit;
