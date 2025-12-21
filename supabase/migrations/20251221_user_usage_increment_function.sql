-- Helper function to increment continue usage atomically
begin;

create or replace function public.increment_continue_usage(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.user_usage (user_id, free_continues_used, updated_at)
  values (p_user_id, 1, now())
  on conflict (user_id)
  do update set
    free_continues_used = user_usage.free_continues_used + 1,
    updated_at = now();
end;
$$;

commit;
