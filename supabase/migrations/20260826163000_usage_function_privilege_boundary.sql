-- Lock Buddy's usage counter to the trusted server boundary.
--
-- The original SECURITY DEFINER function was created in public without an
-- explicit search_path or EXECUTE revocation, so PostgreSQL's default grants
-- allowed untrusted API roles to invoke it with any user UUID.
begin;

create or replace function public.increment_continue_usage(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  insert into public.user_usage (user_id, free_continues_used, updated_at)
  values (p_user_id, 1, now())
  on conflict (user_id)
  do update set
    free_continues_used = public.user_usage.free_continues_used + 1,
    updated_at = now();
end;
$$;

revoke all on function public.increment_continue_usage(uuid) from public;
revoke all on function public.increment_continue_usage(uuid) from anon;
revoke all on function public.increment_continue_usage(uuid) from authenticated;
grant execute on function public.increment_continue_usage(uuid) to service_role;

commit;
