# Signed upload provider boundary — 2026-08-30

## Scope

Buddy The Underwriter's canonical server-side upload signing helpers for configured GCS and Supabase Storage.

## Evidence and root cause

- The Supabase helper fell back from `createSignedUploadUrl` to `createSignedUrl`, even though Supabase documents the former for uploads and the latter for sharing/downloading an existing asset.
- When `DOC_STORE=gcs`, any GCS signing failure silently switched the write to Supabase Storage. That could split canonical bytes across providers while the configured provider was unavailable.
- Signing logs included storage bucket/object paths, raw provider errors, and stack details.
- File admission accepted negative or fractional byte counts and did not reuse the repository's bounded filename normalization.

## Repair

- Accept only complete `createSignedUploadUrl` evidence with a bounded URL, upload token, and optional path.
- Remove the download-URL fallback.
- Fail closed when the configured GCS signer is unavailable; never switch providers within a request.
- Redact signing logs to request id, provider, timeout, and safe status only.
- Clear signing timeout timers deterministically.
- Require positive safe-integer sizes and bounded filenames.
- Add behavioral and structural regression coverage for the complete boundary.

## Provider contract

- https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl
- https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl
- https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl

## Safety

Source, tests, and commissioning evidence only. No bucket, object, credential, provider configuration, database, schema, dependency, or production-data mutation.

## Closure

Exact-head tests, complete diff, required workflows, and Vercel preview evidence are pending PR creation. Post-merge transactional closure requires authorized GCS and Supabase sandbox upload fixtures.
