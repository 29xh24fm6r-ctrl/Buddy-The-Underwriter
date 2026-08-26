# Upload storage CORS (doc intake)

Deal documents never pass through Next.js. The browser asks the server for a
V4 signed URL, then PUTs the bytes straight to the GCS uploads bucket
(`GCS_BUCKET`, prod: `buddy-the-underwriter-uploads`). Because that PUT carries
`Content-Type` **and** the signed `x-goog-content-length-range` header, it is
never a CORS "simple request" — every upload is preceded by a preflight the
bucket itself must answer.

If the bucket's CORS allowlist does not contain the origin the app is served
from, GCS answers the preflight `200` with **no** `Access-Control-Allow-Origin`
header, the browser cancels the PUT (`net::ERR_FAILED`), and every document in
the batch fails before a byte leaves the tab. Nothing server-side logs an
error, because the server was never called.

## The 2026-08-26 outage

The bucket allowlisted only `https://buddysba.com` and
`https://www.buddysba.com`. The authenticated app runs on
`https://app.buddytheunderwriter.com` (`APP_ORIGIN` in
`src/lib/navigation/clerkHosts.ts`), so 100% of banker intake preflights were
refused. The UI reported "Upload session expired/invalid — restart deal
creation", which was wrong twice over: the session was fine, and restarting
re-ran the identical preflight.

## Source of truth

`src/lib/storage/uploadCorsConfig.ts` holds the canonical allowlist, derived
from `APP_ORIGIN` + `CLERK_MARKETING_HOSTS` (borrower portal links resolve on
those domains) + `http://localhost:3000`.

`cors.json` at the repo root is the artifact applied to the bucket and is
generated from that module. `pnpm guard:upload-cors` (part of `pnpm guard:all`)
fails the build if the two drift, so adding a domain can no longer silently
ship a domain whose uploads are blocked.

## Commands

```bash
pnpm check:gcs-cors     # probe the LIVE bucket preflight per origin (no credentials needed)
pnpm gcs:cors:print     # print the canonical config
pnpm gcs:cors:write     # regenerate cors.json after changing the origin list
pnpm gcs:cors:apply     # apply cors.json to $GCS_BUCKET (needs ADC), then re-check
```

`--apply` uses Application Default Credentials, so run it from an operator
machine after `gcloud auth application-default login` — Vercel's Workload
Identity Federation is request-scoped and unavailable to a CLI. The equivalent
one-liner:

```bash
gcloud storage buckets update gs://buddy-the-underwriter-uploads --cors-file=cors.json
```

CORS changes take effect immediately, but a browser caches a successful
preflight for `maxAgeSeconds` (3600). A failed preflight is not cached, so
recovery is immediate for the users who were blocked.

## Preview deployments

GCS matches origins exactly and has no wildcard-subdomain form, so
`*.vercel.app` previews are deliberately not allowlisted — widening this to
`*` on a bucket holding borrower tax returns is not acceptable. To test
uploads from a preview, add that exact preview origin temporarily or point the
preview at a scratch bucket.

## Symptom → cause

| Browser console | Meaning |
| --- | --- |
| `blocked by CORS policy: No 'Access-Control-Allow-Origin'` on `storage.googleapis.com` | This document. Bucket allowlist is missing the app origin. |
| `PUT … net::ERR_FAILED` with no CORS line | Network/connectivity, or the object path was rejected. |
| `403` from the PUT | Signed URL expired or headers did not match the signature — the upload session really is spent. |

The client mirrors that split: a PUT that never reaches storage now throws
`upload_transport_blocked` (banner: "Uploads are being blocked before they
reach storage… nothing needs restarting"), and only a real HTTP status from
storage throws `upload_session_expired_restart`.
