# PR Checklist (Buddy)

## Repo hygiene

* [ ] No new top-level folders outside src/, supabase/, docs/
* [ ] No new lockfiles (pnpm only)

## Tenancy & security

* [ ] Every server-side read/write is scoped by bank_id (or enforced by RLS)
* [ ] No service role key leaks to client runtime

## Engines

* [ ] Deterministic engines decide state
* [ ] AI only annotates/explains and stores confidence/reasoning

## Ledger

* [ ] Major actions write to canonical ledger
* [ ] Errors are logged with correlation/run ids

## UX safety

* [ ] No red states unless truly blocked
* [ ] Optimistic UI only when backend guarantees eventual reconciliation
