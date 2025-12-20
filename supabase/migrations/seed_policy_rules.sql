-- Example Policy Rules (Seed Data)
-- Replace 'YOUR_BANK_ID_HERE' with your actual bank UUID from the banks table

-- CRE Max LTV Rule (Hard fail)
insert into public.bank_policy_rules
(bank_id, rule_key, title, description, scope, predicate, decision, severity, active)
values
(
  'YOUR_BANK_ID_HERE',
  'cre.max_ltv',
  'CRE Max LTV (80%)',
  'If LTV exceeds 80% on CRE, require exception.',
  '{"deal_type":["Commercial Real Estate"]}'::jsonb,
  '{"and":[{">":["ltv",0.80]},{"exists":["ltv"]}]}'::jsonb,
  '{"result":"fail","message":"LTV exceeds 80% policy max for CRE.","requires_exception":true}'::jsonb,
  'hard',
  true
);

-- SBA Minimum DSCR Rule (Soft warning)
insert into public.bank_policy_rules
(bank_id, rule_key, title, description, scope, predicate, decision, severity, active)
values
(
  'YOUR_BANK_ID_HERE',
  'sba.min_dscr',
  'SBA Minimum DSCR (1.15)',
  'DSCR below 1.15 triggers a soft warning and requires mitigants.',
  '{"deal_type":["SBA 7(a)","SBA 504"]}'::jsonb,
  '{"and":[{"<":["dscr",1.15]},{"exists":["dscr"]}]}'::jsonb,
  '{"result":"warn","message":"DSCR below 1.15 — requires mitigants or stronger guarantor support.","requires_exception":false}'::jsonb,
  'soft',
  true
);

-- Term Loan Maximum Amount (Info)
insert into public.bank_policy_rules
(bank_id, rule_key, title, description, scope, predicate, decision, severity, active)
values
(
  'YOUR_BANK_ID_HERE',
  'term_loan.max_amount',
  'Term Loan Policy Maximum ($5M)',
  'Loans over $5M require senior approval.',
  '{"deal_type":["Term Loan"]}'::jsonb,
  '{"and":[{">":["loan_amount",5000000]},{"exists":["loan_amount"]}]}'::jsonb,
  '{"result":"info","message":"Loan amount exceeds $5M. Senior approval required per policy.","requires_exception":false}'::jsonb,
  'info',
  true
);

-- Equipment FICO Floor (Hard)
insert into public.bank_policy_rules
(bank_id, rule_key, title, description, scope, predicate, decision, severity, active)
values
(
  'YOUR_BANK_ID_HERE',
  'equipment.min_fico',
  'Equipment Loan Minimum FICO (660)',
  'Personal guarantor FICO must be 660+ for equipment loans.',
  '{"deal_type":["Equipment"]}'::jsonb,
  '{"and":[{"<":["fico",660]},{"exists":["fico"]}]}'::jsonb,
  '{"result":"fail","message":"FICO below 660 minimum for equipment loans.","requires_exception":true}'::jsonb,
  'hard',
  true
);

-- Owner-Occupied CRE Cash Injection Requirement (Soft)
insert into public.bank_policy_rules
(bank_id, rule_key, title, description, scope, predicate, decision, severity, active)
values
(
  'YOUR_BANK_ID_HERE',
  'cre.oo_cash_injection',
  'Owner-Occupied CRE Cash Injection (10%)',
  'Owner-occupied CRE requires minimum 10% cash injection.',
  '{"deal_type":["Commercial Real Estate"]}'::jsonb,
  '{"and":[{"=":["owner_occupied",true]},{"<":["cash_injection",0.10]},{"exists":["cash_injection"]}]}'::jsonb,
  '{"result":"warn","message":"Cash injection below 10% for owner-occupied CRE.","requires_exception":false}'::jsonb,
  'soft',
  true
);
