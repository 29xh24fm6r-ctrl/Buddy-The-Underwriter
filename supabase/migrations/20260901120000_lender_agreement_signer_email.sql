-- Lender notice address.
--
-- getLenderCommsRecipients() has always selected lender_marketplace_agreements
-- .signed_by_email, but the column was never created. PostgREST rejects the
-- whole request on an unknown column, so every lender email — preview, claim,
-- selection, closing, funding — failed at recipient lookup and was returned as
-- "message_dependency_read_failed". No lender notification has ever been sent.
--
-- Additive only: a nullable column beside the existing signed_by_name.
alter table public.lender_marketplace_agreements
  add column if not exists signed_by_email text;

comment on column public.lender_marketplace_agreements.signed_by_email is
  'Contractual notice address for the signer. Preferred recipient for lender lifecycle messaging; when null the CRM lender contacts are used instead.';
