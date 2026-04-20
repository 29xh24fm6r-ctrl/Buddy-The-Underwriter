# Honeycomb + OpenTelemetry setup (Buddy)

Buddy already uses Next.js `instrumentation.ts` to bootstrap observability.
This repo adds OpenTelemetry (OTLP/HTTP) export support so you can trace server-side API routes (including auto-seed).

## 1) Create Honeycomb dataset + API key
- In Honeycomb, create (or pick) a dataset for traces.
- Create an API key with permissions to send events.

## 2) Configure env vars
Set either the Honeycomb-native vars:

```bash
HONEYCOMB_API_KEY=...
HONEYCOMB_DATASET=...
OTEL_SERVICE_NAME=buddy-the-underwriter
```

Or configure OTLP directly:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io/v1/traces
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_KEY,x-honeycomb-dataset=YOUR_DATASET
OTEL_SERVICE_NAME=buddy-the-underwriter
```

Notes:
- `src/instrumentation.ts` initializes tracing only in `nodejs` runtime.
- Initialization is skipped unless Honeycomb/OTLP env vars are set.

## 3) What to look for in Honeycomb
Search spans by name:
- `auto-seed.POST`
- `auto-seed.fetch-intake`
- `auto-seed.upsert-checklist`
- `auto-seed.reconcile-uploads`
- `auto-seed.reconcile-deal-checklist`
- `auto-seed.auto-match`
- `auto-seed.recompute-readiness`

Useful attributes:
- `deal.id`, `bank.id`
- `auto_seed.partial`, `auto_seed.force`, `auto_seed.match`
- `auto_seed.expected`, `auto_seed.persisted`, `auto_seed.remaining`
