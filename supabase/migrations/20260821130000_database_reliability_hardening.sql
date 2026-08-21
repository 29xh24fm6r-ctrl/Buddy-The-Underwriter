begin;

-- Database reliability hardening.
--
-- 1. Telemetry views must enforce the querying role's underlying RLS instead
--    of executing with the view owner's privileges.
-- 2. QA lifecycle RPCs are service-only administrative operations.
-- 3. Cache auth.uid() once per statement in the assumptions-events policy.

alter view public.v_beat_ttfa_by_deal set (security_invoker = true);
alter view public.v_beat_formless_start_by_deal set (security_invoker = true);
alter view public.v_beat_repeat_ask_by_deal set (security_invoker = true);
alter view public.v_beat_doc_request_rounds_by_deal set (security_invoker = true);
alter view public.v_beat_lender_followup_by_deal set (security_invoker = true);
alter view public.v_beat_summary set (security_invoker = true);

revoke all on function public.create_qa_test_application(uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.create_qa_test_application(uuid,text,text,text,text,text)
  to service_role;

revoke all on function public.cleanup_test_data(text,timestamptz,timestamptz,boolean,text)
  from public, anon, authenticated;
grant execute on function public.cleanup_test_data(text,timestamptz,timestamptz,boolean,text)
  to service_role;

drop policy if exists buddy_sba_assumptions_events_bank_access
  on public.buddy_sba_assumptions_events;
create policy buddy_sba_assumptions_events_bank_access
  on public.buddy_sba_assumptions_events
  for all
  using (
    exists (
      select 1
      from public.bank_memberships bm
      where bm.bank_id = buddy_sba_assumptions_events.bank_id
        and bm.user_id = (select auth.uid())
        and bm.role in ('owner', 'admin', 'member')
    )
  )
  with check (
    exists (
      select 1
      from public.bank_memberships bm
      where bm.bank_id = buddy_sba_assumptions_events.bank_id
        and bm.user_id = (select auth.uid())
        and bm.role in ('owner', 'admin', 'member')
    )
  );

notify pgrst, 'reload schema';

commit;
