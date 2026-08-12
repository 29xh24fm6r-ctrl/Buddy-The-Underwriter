# Buddy LOS document-intelligence provider

Buddy The Underwriter can be packaged as a separately deployed, separately entitled document-intelligence module for Buddy LOS. It reuses the Underwriter OCR and institutional classification spine, but it does not read or write the LOS database and does not become a second loan system of record.

## Safety state

- The provider is off unless both `BUDDY_LOS_PROVIDER_ONLY=true` and `BUDDY_LOS_PROVIDER_ENABLED=true` are present.
- The website deployment cannot expose the provider merely by setting the enable flag; it must be a provider-only deployment.
- Every request requires a server-only bearer key and an exact organization ID in the entitlement allowlist.
- Every document is rebound to the LOS request by contract version, idempotency key, media type, byte length, and SHA-256 before OCR.
- Results require human review. The provider never approves credit, changes a loan record, or persists a competing document ledger.

## Contract

Deploy the repository's `services/buddy-los-document-intelligence/Dockerfile` as its own service. Buddy LOS calls:

`POST /api/providers/buddy-los/document-intelligence`

The request and response implement `buddy-document-intelligence.v1`, including the exact LOS job, organization, deal, document, version, and hash identities. Supported inputs are PDF, PNG, JPEG, TIFF, and WebP, up to 25 MiB. The 25 MiB service limit stays below Cloud Run's 32 MiB HTTP/1 request ceiling. Do not deploy this multipart endpoint as a Vercel Function; Vercel currently caps Function request bodies at 4.5 MB.

## Required service configuration

| Variable | Purpose |
| --- | --- |
| `BUDDY_LOS_PROVIDER_ONLY=true` | Restricts the deployment to provider routes. |
| `BUDDY_LOS_PROVIDER_ENABLED=false` | Master kill switch; keep false until commissioning approval. |
| `BUDDY_LOS_PROVIDER_API_KEY` | Random 32+ character server-only bearer key. |
| `BUDDY_LOS_PROVIDER_ORGANIZATION_IDS` | Comma-separated LOS organization IDs entitled to this separately sold module. |
| `BUDDY_LOS_PROVIDER_NAME=buddy-underwriter` | Identity Buddy LOS must expect in the response. |

The existing Gemini/Vertex OCR configuration is required. `MISTRAL_API_KEY` is optional and enables the existing OCR fallback. No Supabase or Clerk credentials are required for provider requests.

## Controlled deployment (not executed by this PR)

1. Build the image from the repository root using the provider Dockerfile and an immutable Git SHA tag.
2. Deploy it as a new Cloud Run service with `BUDDY_LOS_PROVIDER_ENABLED=false` and no production LOS endpoint configured.
3. Supply the key through Secret Manager, not a command line or committed file.
4. Add only a non-production organization to the entitlement allowlist.
5. Verify `/api/providers/buddy-los/health` returns 503 while disabled.
6. With explicit activation approval, enable only the sandbox service and run contract, duplicate submission, wrong-tenant, wrong-key, hash-tamper, MIME-mismatch, oversize, timeout, and OCR-fallback tests.
7. Only after that evidence is accepted, separately configure Buddy LOS's endpoint, provider identity, and matching secret.

Production deployment, production enablement, LOS configuration, and customer entitlement are deliberately outside this change.
