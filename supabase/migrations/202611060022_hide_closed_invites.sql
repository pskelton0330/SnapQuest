begin;

create or replace function public.get_hunt_invites(p_hunt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_status text;
  v_active_count integer;
  v_recoverable_count integer;
  v_codes jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then raise exception 'Organizer access required'; end if;
  select status into v_status from public.hunts where id=p_hunt_id;
  if v_status is null then raise exception 'Hunt not found'; end if;
  if v_status not in ('scheduled','active') then
    return jsonb_build_object('has_active_invites',false,'recoverable',true,'invite_codes',v_codes);
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name='snapquest_invite_recovery_key';
  if v_key is null then raise exception 'Invitation recovery is temporarily unavailable'; end if;
  select count(*)::integer into v_active_count from public.invitations i where i.hunt_id=p_hunt_id and i.revoked_at is null;
  select count(*)::integer into v_recoverable_count from public.invitations i join private.invitation_token_secrets s on s.invitation_id=i.id where i.hunt_id=p_hunt_id and i.revoked_at is null;
  if v_active_count=v_recoverable_count then
    select coalesce(jsonb_agg(jsonb_build_object('team_id',i.team_id,'team_name',coalesce(t.name,'Balanced team assignment'),'invite_token',extensions.pgp_sym_decrypt(s.token_ciphertext,v_key)::text) order by t.display_order nulls first),'[]'::jsonb) into v_codes
    from public.invitations i join private.invitation_token_secrets s on s.invitation_id=i.id left join public.teams t on t.id=i.team_id
    where i.hunt_id=p_hunt_id and i.revoked_at is null;
  end if;
  return jsonb_build_object('has_active_invites',v_active_count>0,'recoverable',v_active_count=v_recoverable_count,'invite_codes',v_codes);
end;
$$;
revoke all on function public.get_hunt_invites(uuid) from public;
grant execute on function public.get_hunt_invites(uuid) to authenticated;

commit;
