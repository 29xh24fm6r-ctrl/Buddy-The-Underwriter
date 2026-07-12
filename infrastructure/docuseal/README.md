# DocuSeal deployment runbook

**Status as of 2026-07-12: not deployed.** This directory is complete,
ready-to-run infrastructure config committed per ARC-00 SPEC S3 addendum
("DocuSeal production deployment is out of executor scope unless GCP
credentials available... Acceptable: Dockerfile + cloudrun.yaml + README
committed; actual deployment by Matt or a separate ops handoff"). The
executing session had no `gcloud` CLI and no GCP credentials — PIV-4 could
not be satisfied. Everything below is ready for whoever has Cloud Run admin
access on the `buddy-the-underwriter` GCP project.

## AGPL-3.0 license position

DocuSeal is AGPL-3.0. Running an **unmodified** upstream container as a
service, accessed only via its REST API and embedded iframe, does not
trigger the AGPL's source-disclosure obligation — that obligation is
triggered by *distributing a modified version*, not by operating an
unmodified program as a network service. This is settled by FSF guidance
on AGPL. **Do not modify DocuSeal source under any circumstance.** If
Persona/DocuSeal prefill behavior or any other requirement ever seems to
need a DocuSeal source change, that is a separate spec with general
counsel review attached — not something to route around here.

## 1. Build + push to Artifact Registry

```sh
# Confirm the current latest stable tag before building — do not blindly
# reuse the tag below. Check https://github.com/docusealco/docuseal/releases.
# Pinned at authoring time (2026-07-12): 3.1.3.
docker build -t us-central1-docker.pkg.dev/buddy-the-underwriter/buddy-workers/docuseal:3.1.3 \
  infrastructure/docuseal/

gcloud auth configure-docker us-central1-docker.pkg.dev

docker push us-central1-docker.pkg.dev/buddy-the-underwriter/buddy-workers/docuseal:3.1.3
```

Confirm the Artifact Registry repo exists first:

```sh
gcloud artifacts repositories describe buddy-workers \
  --location=us-central1 --project=buddy-the-underwriter
```

## 2. Provision secrets (Cloud Run secrets, NOT Vercel env)

```sh
# DATABASE_URL — see "Database provisioning" below for where this points
echo -n "postgres://..." | gcloud secrets create docuseal-database-url \
  --data-file=- --project=buddy-the-underwriter

# SECRET_KEY_BASE — Rails secret, generate once and never rotate casually
# (rotating invalidates all existing signed sessions/cookies)
openssl rand -hex 64 | gcloud secrets create docuseal-secret-key-base \
  --data-file=- --project=buddy-the-underwriter
```

## 3. Deploy

```sh
gcloud run services replace infrastructure/docuseal/cloudrun.yaml \
  --project=buddy-the-underwriter --region=us-central1
```

`autoscaling.knative.dev/minScale: "1"` keeps one instance warm to avoid
cold starts during a live signing ceremony — roughly $20–30/month.

## 4. Domain mapping

Point `docuseal.buddytheunderwriter.com` at the Cloud Run service via
GoDaddy DNS (CNAME to the Cloud Run domain-mapping target) and run:

```sh
gcloud run domain-mappings create --service=buddy-docuseal \
  --domain=docuseal.buddytheunderwriter.com \
  --region=us-central1 --project=buddy-the-underwriter
```

## 5. Database provisioning

DocuSeal owns its own Postgres schema entirely — **no Buddy data lives
there, and Buddy's RLS policies do not apply to it.** Two options:

- **Separate Supabase project** (recommended — clean isolation, own
  backup/restore lifecycle, no risk of DocuSeal migrations colliding with
  Buddy's schema).
- **Separate schema in the existing Buddy Supabase project** (cheaper, but
  couples DocuSeal's migration lifecycle to Buddy's primary DB — avoid
  unless there's a strong cost reason).

Whichever is chosen, back it up on the same cadence as Buddy's primary DB
(risk register #9 in SPEC-S3).

## 6. Generate the API token + upload templates

Once the service is live and reachable:

1. Log into the DocuSeal admin UI at `https://docuseal.buddytheunderwriter.com`.
2. Generate an API token (Settings → API). Store it as `DOCUSEAL_API_TOKEN`
   in Vercel env (NOT a Cloud Run secret — this is consumed by the Buddy
   Next.js app, not by DocuSeal itself).
3. Configure a webhook pointing at
   `https://<buddy-app-domain>/api/esign/docuseal/webhook`, with a secret —
   store that secret as `DOCUSEAL_WEBHOOK_SECRET` in Vercel env. Confirm
   the exact signature header/format DocuSeal sends against
   `src/lib/esign/docuseal/verifyDocusealWebhook.ts` — that file assumes
   `X-Docuseal-Signature: <hex HMAC-SHA256 of raw body>`, which was not
   verified against a live instance in this build (no deployment existed
   to test against). Adjust the verification function if the real
   instance's header differs.
4. Upload the SBA Form 1919 and Form 413 templates via the admin UI (PDFs
   sourced the same way as `scripts/ingest-sba-templates.ts` — see ARC-00
   Phase 0.C). Capture each template's ID and set:
   - `DOCUSEAL_TEMPLATE_FORM_1919`
   - `DOCUSEAL_TEMPLATE_FORM_413`

## Version log

| Date | Tag | Notes |
|---|---|---|
| 2026-07-12 | 3.1.3 | Pinned at authoring time; latest stable per GitHub releases. Not yet deployed. |

Review the pinned tag on every quarterly upgrade cycle (risk register #4).
