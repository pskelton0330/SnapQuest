begin;

-- Invitation values remain bearer secrets; keep recoverable copies encrypted with a Vault-held key.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name='snapquest_invite_recovery_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),
      'snapquest_invite_recovery_key','Encryption key for organizer-only invitation recovery');
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.invitation_token_secrets (
  invitation_id uuid primary key references public.invitations(id) on delete cascade,
  token_ciphertext bytea not null,
  created_at timestamptz not null default clock_timestamp()
);
revoke all on private.invitation_token_secrets from public, anon, authenticated;

create or replace function public.publish_hunt(
  p_hunt_id uuid,
  p_team_names text[],
  p_assignment_mode text,
  p_start_at timestamptz,
  p_voting_enabled boolean default false,
  p_voting_bonus_points integer default 0
) returns table(team_id uuid,team_name text,invite_token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_hunt public.hunts%rowtype;
  v_name text;
  v_team_id uuid;
  v_invitation_id uuid;
  v_index integer := 0;
  v_token text;
  v_key text;
  v_colors text[] := array['#E87983','#E9B44C','#8175C7','#60A897','#E58C54','#5F8DC8','#C46B9E','#82A55B','#D0695C','#718096','#BA85C4','#4F9BA8'];
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then raise exception 'Organizer access required'; end if;
  select * into v_hunt from public.hunts h where h.id=p_hunt_id for update;
  if v_hunt.status <> 'draft' then raise exception 'Only a draft hunt can be published'; end if;
  if p_assignment_mode is null or p_assignment_mode not in ('organizer','balanced') then raise exception 'Choose a supported team assignment method'; end if;
  if p_start_at is not null and p_start_at < now()-interval '1 minute' then raise exception 'Choose a start time in the future'; end if;
  if coalesce(cardinality(p_team_names),0) not between 2 and 12 then raise exception 'Add between 2 and 12 teams'; end if;
  if exists(select 1 from unnest(p_team_names) n where char_length(trim(n)) not between 1 and 40) then raise exception 'Team names must contain 1 to 40 characters'; end if;
  if (select count(distinct lower(trim(n))) from unnest(p_team_names) n) <> cardinality(p_team_names) then raise exception 'Team names must be unique'; end if;
  if not exists(select 1 from public.hunt_items hi where hi.hunt_id=p_hunt_id) then raise exception 'Add at least one photo challenge before publishing'; end if;
  if coalesce(p_voting_bonus_points,0) not between 0 and 1000 then raise exception 'Voting bonus must be between 0 and 1000 points'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name='snapquest_invite_recovery_key';
  if v_key is null then raise exception 'Invitation recovery is temporarily unavailable'; end if;

  update public.hunts set status='scheduled',team_assignment_mode=p_assignment_mode,start_at=p_start_at,
    voting_enabled=coalesce(p_voting_enabled,false),voting_bonus_points=coalesce(p_voting_bonus_points,0)
  where id=p_hunt_id;

  foreach v_name in array p_team_names loop
    v_index:=v_index+1;
    insert into public.teams(hunt_id,name,display_color,display_order)
    values(p_hunt_id,trim(v_name),v_colors[v_index],v_index-1) returning id into v_team_id;
    if p_assignment_mode='organizer' then
      v_token:=encode(extensions.gen_random_bytes(32),'hex');
      insert into public.invitations(hunt_id,team_id,token_hash)
      values(p_hunt_id,v_team_id,encode(extensions.digest(v_token,'sha256'),'hex')) returning id into v_invitation_id;
      insert into private.invitation_token_secrets(invitation_id,token_ciphertext)
      values(v_invitation_id,extensions.pgp_sym_encrypt(v_token,v_key));
      team_id:=v_team_id; team_name:=trim(v_name); invite_token:=v_token; return next;
    end if;
  end loop;

  if p_assignment_mode='balanced' then
    v_token:=encode(extensions.gen_random_bytes(32),'hex');
    insert into public.invitations(hunt_id,team_id,token_hash)
    values(p_hunt_id,null,encode(extensions.digest(v_token,'sha256'),'hex')) returning id into v_invitation_id;
    insert into private.invitation_token_secrets(invitation_id,token_ciphertext)
    values(v_invitation_id,extensions.pgp_sym_encrypt(v_token,v_key));
    team_id:=null; team_name:='Balanced team assignment'; invite_token:=v_token; return next;
  end if;
end;
$$;
revoke all on function public.publish_hunt(uuid,text[],text,timestamptz,boolean,integer) from public;
grant execute on function public.publish_hunt(uuid,text[],text,timestamptz,boolean,integer) to authenticated;

create or replace function public.regenerate_hunt_invites(p_hunt_id uuid)
returns table(team_id uuid,team_name text,invite_token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_hunt public.hunts%rowtype;
  v_team public.teams%rowtype;
  v_invitation_id uuid;
  v_token text;
  v_key text;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then raise exception 'Organizer access required'; end if;
  select * into v_hunt from public.hunts h where h.id=p_hunt_id for update;
  if v_hunt.status not in ('scheduled','active') then raise exception 'Invitation links are not available for this hunt'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name='snapquest_invite_recovery_key';
  if v_key is null then raise exception 'Invitation recovery is temporarily unavailable'; end if;
  update public.invitations i set revoked_at=clock_timestamp() where i.hunt_id=p_hunt_id and i.revoked_at is null;

  if v_hunt.team_assignment_mode='balanced' then
    v_token:=encode(extensions.gen_random_bytes(32),'hex');
    insert into public.invitations(hunt_id,team_id,token_hash)
    values(p_hunt_id,null,encode(extensions.digest(v_token,'sha256'),'hex')) returning id into v_invitation_id;
    insert into private.invitation_token_secrets(invitation_id,token_ciphertext)
    values(v_invitation_id,extensions.pgp_sym_encrypt(v_token,v_key));
    team_id:=null; team_name:='Balanced team assignment'; invite_token:=v_token; return next;
  else
    for v_team in select * from public.teams t where t.hunt_id=p_hunt_id order by t.display_order loop
      v_token:=encode(extensions.gen_random_bytes(32),'hex');
      insert into public.invitations(hunt_id,team_id,token_hash)
      values(p_hunt_id,v_team.id,encode(extensions.digest(v_token,'sha256'),'hex')) returning id into v_invitation_id;
      insert into private.invitation_token_secrets(invitation_id,token_ciphertext)
      values(v_invitation_id,extensions.pgp_sym_encrypt(v_token,v_key));
      team_id:=v_team.id; team_name:=v_team.name; invite_token:=v_token; return next;
    end loop;
  end if;
end;
$$;
revoke all on function public.regenerate_hunt_invites(uuid) from public;
grant execute on function public.regenerate_hunt_invites(uuid) to authenticated;

create or replace function public.get_hunt_invites(p_hunt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_active_count integer;
  v_recoverable_count integer;
  v_codes jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then raise exception 'Organizer access required'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name='snapquest_invite_recovery_key';
  if v_key is null then raise exception 'Invitation recovery is temporarily unavailable'; end if;
  select count(*)::integer into v_active_count from public.invitations i
    where i.hunt_id=p_hunt_id and i.revoked_at is null;
  select count(*)::integer into v_recoverable_count from public.invitations i
    join private.invitation_token_secrets s on s.invitation_id=i.id
    where i.hunt_id=p_hunt_id and i.revoked_at is null;
  if v_active_count=v_recoverable_count then
    select coalesce(jsonb_agg(jsonb_build_object(
      'team_id',i.team_id,
      'team_name',coalesce(t.name,'Balanced team assignment'),
      'invite_token',extensions.pgp_sym_decrypt(s.token_ciphertext,v_key)::text
    ) order by t.display_order nulls first),'[]'::jsonb) into v_codes
    from public.invitations i
    join private.invitation_token_secrets s on s.invitation_id=i.id
    left join public.teams t on t.id=i.team_id
    where i.hunt_id=p_hunt_id and i.revoked_at is null;
  end if;
  return jsonb_build_object('has_active_invites',v_active_count>0,'recoverable',v_active_count=v_recoverable_count,'invite_codes',v_codes);
end;
$$;
revoke all on function public.get_hunt_invites(uuid) from public;
grant execute on function public.get_hunt_invites(uuid) to authenticated;

commit;
