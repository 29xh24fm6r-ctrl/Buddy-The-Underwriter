-- Create whoami() function for testing RLS auth.uid()
-- This verifies that Buddy-signed JWTs are working correctly

create or replace function public.whoami()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'uid', auth.uid(),
    'role', auth.role(),
    'jwt_claims', auth.jwt()
  );
$$;

-- Security: Allow authenticated users to call this
revoke all on function public.whoami() from public;
grant execute on function public.whoami() to anon, authenticated;

comment on function public.whoami is 'Debug function to verify auth.uid() is set correctly via Buddy JWT';
