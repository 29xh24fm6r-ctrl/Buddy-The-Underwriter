# SBA E-Tran credential rotation runbook

Applies to `bank_etran_credentials` (migration `20260605_c_etran_credentials.sql`)
and the encrypt/decrypt RPCs (`20260605_d_etran_rpc.sql`). Per-bank mutual-TLS
client certificate + key used by `src/lib/etran/etranHttpClient.ts` to POST
directly to SBA E-Tran.

## What's stored, and how

- `client_cert_pem_encrypted` / `client_key_pem_encrypted` — `bytea`, encrypted
  with `pgp_sym_encrypt` (pgcrypto, lives in the `extensions` schema on this
  Supabase project — see the migration's AP-3 note) inside the
  `etran_upsert_credentials` SECURITY DEFINER RPC. Plaintext PEM only exists
  in-process for the duration of a request; it is never logged.
- `bank_etran_credentials` itself has RLS policy `bec_deny` — `USING (false)`.
  No row is readable through PostgREST/the anon or authenticated roles, ever.
  The only access path is `service_role` calling the two RPCs directly.
- The encryption key is `ETRAN_CRED_ENCRYPTION_KEY`, a Vercel env var. It is
  NOT stored in the database anywhere. Losing it makes all stored credentials
  permanently unrecoverable — rotating it requires re-entering every bank's
  cert via the admin UI (see below), not a data migration.

## Normal rotation (cert nearing `cert_expires_at`)

1. Obtain the new client certificate + private key from the bank's SBA
   E-Tran enrollment (this is issued by SBA/their CA per lender agreement —
   not something Buddy generates).
2. Bank admin (role `bank_admin`) navigates to
   `/banks/[bankId]/templates` → "SBA Integration Settings" →
   "Rotate Credentials".
3. Paste the new cert + key PEM, set `cert_expires_at` from the new cert,
   save. This calls `POST /api/banks/[bankId]/etran/credentials`, which
   calls `storeEtranCredentials()` → `etran_upsert_credentials` RPC →
   `ON CONFLICT (bank_id) DO UPDATE` (one row per bank; rotation overwrites
   in place, `last_rotation_at` stamped).
4. Confirm via GET on the same route (the panel reloads automatically) that
   `last_rotation_at` and `cert_expires_at` reflect the new cert.
5. Submit one sandbox-environment E-Tran application (via the
   `submit-etran` action on `/api/deals/[dealId]/sba`, with
   `endpoint_environment` set to `sandbox` for that bank) to confirm the new
   cert authenticates before relying on it for production submissions.

## Emergency rotation (suspected key compromise)

Same steps as above, but do it immediately and treat the old cert as
compromised — coordinate with the bank to have SBA revoke the old cert on
their end too. This runbook has no way to "disable" credentials short of
overwriting them with a new (even if temporarily invalid) value, since the
table has no separate `revoked` flag — overwrite with placeholder PEM
content if a bank needs to be locked out of submission entirely until a real
replacement cert is available (`submitToSba` will then fail closed with
`SBA_REJECTED` or `NETWORK_ERROR` from SBA's side, never `ok: true`).

## `ETRAN_CRED_ENCRYPTION_KEY` rotation (rare — only if the key itself is compromised)

There is no in-place re-encryption path today. To rotate the key:

1. For each bank with configured credentials, fetch the current plaintext
   PEM out-of-band (the bank re-supplies it, since there is no decrypt-and-
   redisplay path in the admin UI by design).
2. Set the new `ETRAN_CRED_ENCRYPTION_KEY` value in Vercel env.
3. Re-run the "Rotate Credentials" flow above for every bank with the same
   PEM content, now encrypting under the new key.
4. Old encrypted rows are overwritten in step 3's `ON CONFLICT` — there is
   no window where both old- and new-key-encrypted rows coexist per bank.

This is manual and does not scale gracefully past a handful of banks. If
E-Tran credential rotation becomes a frequent multi-bank operation, a
proper key-versioning scheme (`encryption_key_version` column, decrypt with
either key during a migration window) is a separate spec — out of scope for
this gate (AP-2).
