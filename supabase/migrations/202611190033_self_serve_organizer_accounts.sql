begin;

-- Allow a verified, non-anonymous account to create its own organizer profile.
-- The authenticated client cannot insert organizer rows for another user.
create or replace function public.ensure_my_organizer_profile()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organizer_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in to create an organizer profile';
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = v_user_id
      and u.email is not null
      and u.email_confirmed_at is not null
      and coalesce(u.is_anonymous, false) = false
  ) then
    raise exception 'Confirm your email address before creating an organizer profile';
  end if;

  insert into public.organizers(auth_user_id)
  values (v_user_id)
  on conflict (auth_user_id) do nothing;

  select id into v_organizer_id
  from public.organizers
  where auth_user_id = v_user_id;

  return v_organizer_id;
end;
$$;

revoke all on function public.ensure_my_organizer_profile() from public, anon;
grant execute on function public.ensure_my_organizer_profile() to authenticated;

commit;
