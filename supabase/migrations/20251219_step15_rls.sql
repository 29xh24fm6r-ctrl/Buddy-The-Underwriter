-- 20251219_step15_rls.sql

begin;

alter table public.deal_upload_links enable row level security;
alter table public.deal_upload_audit enable row level security;
alter table public.deal_files enable row level security;
alter table public.deal_checklist_items enable row level security;
alter table public.deal_reminder_subscriptions enable row level security;
alter table public.deal_reminder_events enable row level security;

-- Conservative defaults: only service role can insert/update/delete.
-- (Service role bypasses RLS anyway, but this prevents accidental anon/auth writes.)
create policy "no_anon_writes_links" on public.deal_upload_links
for insert to anon with check (false);

create policy "no_auth_writes_links" on public.deal_upload_links
for insert to authenticated with check (false);

create policy "no_anon_writes_audit" on public.deal_upload_audit
for insert to anon with check (false);

create policy "no_auth_writes_audit" on public.deal_upload_audit
for insert to authenticated with check (false);

create policy "no_anon_writes_files" on public.deal_files
for insert to anon with check (false);

create policy "no_anon_writes_checklist" on public.deal_checklist_items
for insert to anon with check (false);

create policy "no_anon_writes_reminders" on public.deal_reminder_subscriptions
for insert to anon with check (false);

create policy "no_anon_writes_reminder_events" on public.deal_reminder_events
for insert to anon with check (false);

-- OPTIONAL INTERNAL READ: If you have a membership table, replace this.
-- For now, allow authenticated read (you can tighten later).
create policy "auth_read_links" on public.deal_upload_links
for select to authenticated using (true);

create policy "auth_read_audit" on public.deal_upload_audit
for select to authenticated using (true);

create policy "auth_read_files" on public.deal_files
for select to authenticated using (true);

create policy "auth_read_checklist" on public.deal_checklist_items
for select to authenticated using (true);

create policy "auth_read_reminders" on public.deal_reminder_subscriptions
for select to authenticated using (true);

create policy "auth_read_reminder_events" on public.deal_reminder_events
for select to authenticated using (true);

commit;
