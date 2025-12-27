-- Safe helper for checking Postgres extensions from Supabase
create or replace function public.has_extension(ext text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from pg_extension
    where extname = ext
  );
$$;

grant execute on function public.has_extension(text) to anon, authenticated;
