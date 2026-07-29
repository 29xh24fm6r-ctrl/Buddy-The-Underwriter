# Runbook: BROKERAGE_COMMS_MODE

## What it controls

`BROKERAGE_COMMS_MODE` gates whether brokerage comms (borrower nudges, banker
alerts, outbox sends via `src/lib/brokerage/commsOutbox.ts`) actually hit
Resend (email) / Telnyx (SMS), or stub out.

| Value      | Behavior                                                                 |
|------------|---------------------------------------------------------------------------|
| `stub`     | No external calls. Adapters return a synthetic `ok: true` result. **Default when unset.** |
| `dry_run`  | Builds the real payload and validates provider readiness, but does not call the provider. |
| `live`     | Sends for real via Resend / Telnyx.                                      |

Any other value throws at the first orchestration call (`resolveCommsMode()`
in `src/lib/brokerage/commsMode.ts`) — it does not silently fall back to
`stub`, so a typo in the env var surfaces immediately instead of masquerading
as "comms are working" while nothing sends.

## Where it's set

Vercel project env vars, per environment (Production / Preview / Development).
Check the current value:

```bash
vercel env ls
vercel env pull .env.check   # inspect BROKERAGE_COMMS_MODE, then delete the file
```

## How to verify

1. **Resolved mode is logged once per boot** to `brokerage_comms_ledger`:
   ```sql
   select metadata->>'mode', created_at
   from brokerage_comms_ledger
   where event_type = 'comms_mode_resolved'
   order by created_at desc
   limit 5;
   ```
2. **Readiness check** (env vars required for `live` mode present):
   `assertCommsEnvReady()` in `src/lib/brokerage/commsAdapters.ts` — call it
   from a one-off script or REPL against the running environment.
3. **Unknown-value guard**: setting `BROKERAGE_COMMS_MODE=bogus` and invoking
   `runBrokerageCommsForDeal` throws `Invalid BROKERAGE_COMMS_MODE: "bogus"...`
   — this is the intended fail-loud behavior, not a bug.

## Source of truth

- Mode resolution + startup assertion: `src/lib/brokerage/commsMode.ts`
- Adapter-level mode read (used per-send, not just at boot):
  `src/lib/brokerage/commsAdapters.ts::getCommsMode()`
- Wired into: `src/lib/brokerage/commsOrchestrator.ts::runBrokerageCommsForDeal`
  (both the single-deal and batch entrypoints funnel through this function)
