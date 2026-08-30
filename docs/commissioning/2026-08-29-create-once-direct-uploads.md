# Create-once direct-upload admission

Date: 2026-08-29  
Product: Buddy The Underwriter / www.buddysba.com

## Evidence and root cause

Buddy's production direct-upload path uses a random, server-recorded GCS object key and
a V4 signed PUT URL valid for up to fifteen minutes. The signer constrained content type
and maximum length but did not include a generation precondition. A successful upload
could therefore be overwritten through the same URL after the record endpoint verified
it, leaving canonical size and SHA-256 evidence pointing at different bytes.

The first response can also be lost after GCS commits a PUT. A strict create-once
precondition must preserve that normal retry path without allowing a second write.

## Repair

- Add the GCS `ifGenerationMatch=0` query precondition to the signed V4 PUT.
  GCS accepts the first generation and rejects every later PUT to that key.
- Treat HTTP 412 from the direct upload as an indeterminate successful first write and
  continue to the authoritative record endpoint.
- Keep every other non-2xx storage response as a failure.
- The record endpoint remains responsible for re-reading the server-recorded object and
  refusing canonical persistence when size or SHA-256 does not match.
- Add regression coverage for signer preconditions, 412 recovery, and ordinary conflict
  failure.

## Scope and safety

Buddy The Underwriter only. No schema, credential, provider configuration, production
data, or storage object is changed by this patch. The behavior is reversible application
code. Transactional closure requires Matt's merge and an authorized banker-upload
fixture; it benefits from PR 977's stored-byte verification but does not modify or depend
on PR 977's files.
