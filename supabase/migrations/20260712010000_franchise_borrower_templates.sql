-- Add a "Franchise Documents" template set to every bank's request-template
-- library (borrower_request_templates), so bankers can apply the standard
-- franchise document set (FDD, franchise agreement, SBA addendum) to a deal
-- via the existing template-library UI/apply flow, independent of the
-- automatic per-deal seeding that happens when a franchise brand is linked
-- (see src/lib/franchise/seedFranchiseChecklist.ts).
--
-- Idempotent: only inserts a template for a bank if that bank does not
-- already have a template with the same title.

begin;

insert into public.borrower_request_templates (bank_id, title, category, description, doc_type, year_mode, sort_order, active)
select b.id, t.title, t.category, t.description, t.doc_type, t.year_mode, t.sort_order, true
from public.banks b
cross join (
  values
    ('Franchise Disclosure Document (FDD)', 'legal', 'The most recent FDD issued by the franchisor, including all amendments.', 'franchise_fdd', 'required', 100),
    ('Franchise Agreement', 'legal', 'The signed or to-be-signed franchise agreement with the franchisor.', 'franchise_agreement', 'required', 101),
    ('SBA Franchise Addendum', 'legal', 'Completed SBA addendum to the franchise agreement (SBA Form 2462), required for franchise financing.', 'franchise_addendum', 'required', 102)
) as t(title, category, description, doc_type, year_mode, sort_order)
where not exists (
  select 1 from public.borrower_request_templates existing
  where existing.bank_id = b.id and existing.title = t.title
);

-- Keep future banks in sync automatically.
create or replace function public.seed_franchise_request_templates()
returns trigger
language plpgsql
as $$
begin
  insert into public.borrower_request_templates (bank_id, title, category, description, doc_type, year_mode, sort_order, active)
  values
    (new.id, 'Franchise Disclosure Document (FDD)', 'legal', 'The most recent FDD issued by the franchisor, including all amendments.', 'franchise_fdd', 'required', 100, true),
    (new.id, 'Franchise Agreement', 'legal', 'The signed or to-be-signed franchise agreement with the franchisor.', 'franchise_agreement', 'required', 101, true),
    (new.id, 'SBA Franchise Addendum', 'legal', 'Completed SBA addendum to the franchise agreement (SBA Form 2462), required for franchise financing.', 'franchise_addendum', 'required', 102, true)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_franchise_request_templates on public.banks;
create trigger trg_seed_franchise_request_templates
after insert on public.banks
for each row execute function public.seed_franchise_request_templates();

commit;
