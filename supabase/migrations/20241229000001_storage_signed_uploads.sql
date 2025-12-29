-- Canonical Signed Upload Architecture
-- Zero file bytes through Next.js
-- Supabase Storage is the only byte plane

-- 1. Create private bucket for deal documents
insert into storage.buckets (id, name, public)
values ('deal-documents', 'deal-documents', false)
on conflict (id) do nothing;

-- 2. Storage RLS: Service role only
-- Deny everything by default, clients use signed URLs

-- Allow service role full access
create policy "service_role_full_access"
on storage.objects
for all
to service_role
using (true)
with check (true);

-- Revoke direct access from anon and authenticated
-- (They will use signed URLs from authorized endpoints)
revoke all on storage.objects from anon, authenticated;

-- Note: Signed URLs work regardless of RLS because they are pre-authorized by service role
