-- Heal organizations already typed as lenders with no credit-box row.
--
-- ensureLenderProfile (src/lib/crm/lenderProfile.ts, added by the CRM
-- relationship-intelligence change) keeps the two halves of a bank record —
-- the crm_organizations identity and the crm_lender_profiles credit box —
-- paired from now on. It only runs on write, though, so an organization that
-- was already mismatched stays absent from the Bank buyers workspace, which
-- lists profiles rather than organizations. Production had one such row
-- (Grasshopper Bank), and that is why the CRM reported four organizations
-- and two banks.
--
-- This inserts exactly what ensureLenderProfile would have created: a
-- prospect relationship asserting no appetite. It deliberately does not
-- guess at 7(a)/504/conventional appetite or geography — an empty credit box
-- is honest, and the match engine surfaces it as "Lending geography not
-- recorded" rather than silently ruling the bank in or out.
--
-- Idempotent: the NOT EXISTS guard makes a re-run a no-op, and merged
-- organizations are skipped so a merge tombstone never gains a profile.

insert into public.crm_lender_profiles (
  bank_id, organization_id, relationship_status, lender_type,
  sba_7a_appetite, sba_504_appetite, conventional_appetite
)
select o.bank_id, o.id, 'prospect', 'bank', false, false, false
from public.crm_organizations o
where o.organization_type = 'lender'
  and o.merged_into_id is null
  and not exists (
    select 1 from public.crm_lender_profiles lp
    where lp.organization_id = o.id and lp.bank_id = o.bank_id
  );
