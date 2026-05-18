# Brokerage Deal Timeline

The brokerage deal timeline is a banker-facing, read-only navigation
surface that unifies what happened on a deal — document events, readiness
transitions, comms attempts, banker actions, and system events — into one
chronological view, with safe deep links and exportable evidence packets.

This document is the closeout reference for the Phase 13 timeline stack
(13A → 13B → 13C → 13D).

## Quick reference

| Surface | Where |
|---|---|
| Aggregation module | `src/lib/brokerage/dealTimeline.ts` |
| Export module | `src/lib/brokerage/dealTimelineExport.ts` |
| Timeline API | `GET /api/brokerage/deals/[dealId]/timeline` |
| Export API | `GET /api/brokerage/deals/[dealId]/timeline/export` |
| UI panel | `BrokerageTimelinePanel.tsx` (deal cockpit) |
| Tests | `src/lib/brokerage/__tests__/dealTimeline*.test.ts` |
| Regression script | `pnpm brokerage:timeline:regression` |

## Phase 13A — Unified sources

`getDealTimeline(dealId, sb, opts)` reads from five source tables in
parallel and normalizes each row into a `TimelineEvent`:

| Source table | Category produced | Severity rules |
|---|---|---|
| `deal_events` | document / readiness / system | from `kind` |
| `deal_pipeline_ledger` | document / system | from `status` / `ui_state` |
| `deal_timeline_events` | document / banker_action | info |
| `brokerage_comms_ledger` | comms | from event_type |
| `brokerage_comms_outbox` | comms | from status |

Every event has:

- `category` — `document | readiness | comms | banker_action | system`
- `severity` — `info | success | warning | error`
- `actorType` — `borrower | banker | system | provider`
- `title`, `description` — already redacted
- `metadataSafe` — secret-scrubbed copy of the source payload
- `href` — internal navigation link (see Safe href rules) or `null`

The default `limit` is 50, the API/route cap is 200, and the export cap
is 500 (see Limit caps).

## Phase 13B — Filters + deep links

The timeline supports four filter dimensions, applied after
normalization:

- `categories?: TimelineCategory[]`
- `severities?: TimelineSeverity[]`
- `actorTypes?: TimelineActorType[]`
- `from?: ISO date string`, `to?: ISO date string`

Invalid filter values (categories that don't exist, malformed dates) are
**silently ignored** rather than surfaced as errors — the API never tells
a caller "your filter is bad," it just returns events as if the filter
were absent. This avoids leaking what filter values are valid and keeps
the API tolerant of UI drift.

**Safe href rules** — deep links are generated for three event kinds and
nothing else:

| Category | href shape |
|---|---|
| document (with `relatedEntityId`) | `/deals/{dealId}#document-{id}` |
| readiness | `/deals/{dealId}#readiness` |
| comms | `/admin/brokerage/comms?dealId={dealId}` |

All hrefs are **internal paths only** (`/admin/...` or `/deals/...`).
Storage URLs, provider URLs, webhook URLs, and signed URLs are never
rendered as hrefs and never appear in `metadataSafe` — they're stripped
upstream by `safeMeta()` and the output-side scrubber.

## Phase 13C — Export / evidence packet

`buildDealTimelineExport(dealId, sb, opts)` produces a redacted evidence
packet in either markdown or JSON, suitable for sharing with bankers,
auditors, or counterparties.

### Output shape

**Markdown** (`text/markdown`):

```
# Deal Timeline Export
**Deal ID:** `…`
**Generated:** 2026-05-18T19:34:25Z
**Events:** 12
**Export version:** timeline_export_v1
> [redaction notice]

## Applied filters
- Categories: …
- Severities: …
- Actor types: …
- From: …
- To: …
- Limit: …

## Source summary
| Category | Count |
| document | 5 |
| readiness | 1 |
| comms | 6 |
| banker_action | 0 |
| system | 0 |

## Events
### 2026-05-14
- **12:30Z** `comms/SUCCESS/provider` Outbox: documents received (email) — sent — email to b****r@test.com ([source](/admin/brokerage/comms?dealId=…))
```

**JSON** (`application/json`): `{ metadata, events }` with the same
metadata block and the full `TimelineEvent[]` array.

### Metadata fields

| Field | Type | Meaning |
|---|---|---|
| `dealId` | string | Deal the export was built from |
| `generatedAt` | ISO string | Server time at export build |
| `eventCount` | number | Final count after filters + cap |
| `appliedFilters` | object | Echo of normalized filters (invalid → `null`) |
| `redactionNotice` | string | Standard notice to display with export |
| `sourceSummary` | record | Per-category event counts |
| `exportVersion` | string | `timeline_export_v1` (bumps on shape change) |

### Filenames + Content-Disposition

Filenames are derived as `deal-timeline-{safeSlug}-{timestamp}.{md|json}`.
Deal IDs are slug-sanitized (`[^A-Za-z0-9_-]` stripped, 36-char cap) so
no characters that could break `Content-Disposition` or escape the
attachment name reach the header.

## Redaction guarantees

Two redaction layers run on every export and timeline response:

1. **Source-side**, in `getDealTimeline()` / `normalizeTimelineEvent()`:
   - Email/phone recipients are masked (`j****n@example.com`, `****1234`).
   - Known body keys (`body`, `emailBody`, `smsBody`, `slackBody`,
     `message_body`, `rawToken`, `password`, `secret`) are replaced with
     `[REDACTED]` inside `metadataSafe`.
   - Secret patterns (`re_…`, `KEY…`, `Bearer …`, Slack webhook URLs) are
     stripped from titles, descriptions, and metadata JSON.

2. **Output-side**, in `dealTimelineExport.ts` `scrubOutput()`:
   - Re-runs the secret patterns against the final markdown / JSON string.
   - Additionally strips: `https://storage.googleapis.com/…`,
     `gs://…`, signed URLs containing `X-Goog-Signature`,
     `*.amazonaws.com/…`, `*.blob.core.windows.net/…`.

What this means in practice:

- ✅ Internal hrefs (`/deals/…`, `/admin/brokerage/comms?dealId=…`) are
  allowed.
- ✅ Masked recipients (`j****n@example.com`) are allowed.
- ❌ Raw message bodies are never present.
- ❌ Full recipients (`john.doe@example.com`, `+12025551234`) are never
  present.
- ❌ External storage / provider / webhook URLs are never present.
- ❌ API keys, bearer tokens, signed URLs are never present.

## Read-only invariant

The entire Phase 13 stack performs **zero writes**:

- `dealTimeline.ts` issues five `SELECT … WHERE deal_id = ?` queries
  per request. No `.insert()`, `.update()`, `.delete()`, `.upsert()`.
- `dealTimelineExport.ts` calls `getDealTimeline()` only. It never
  touches source rows directly. No `.insert()`, no SQL, no schema.
- The timeline UI panel makes only `GET` fetches; no `POST/PUT/DELETE`.
- No new tables, no migrations, no triggers.

This is enforced both by code review and by the closeout regression
test in `timelineCloseoutRegression.test.ts`.

## Limit caps

| Surface | Default | Hard cap | Where enforced |
|---|---|---|---|
| `getDealTimeline()` | 50 | **200** | `dealTimeline.ts` |
| Timeline API | 100 | **200** | `timeline/route.ts` |
| `buildDealTimelineExport()` | 200 | **500** | `dealTimelineExport.ts` |
| Export API | 200 | **500** | `timeline/export/route.ts` |

A request asking for more is silently clamped to the cap; the clamped
value is echoed back via `metadata.appliedFilters.limit`.

## Export usage

### From the UI

The "Export timeline" button in the Deal Timeline panel preserves the
currently-applied filter selection. Clicking it downloads a markdown
file named like `deal-timeline-<dealId>-<ts>.md`.

### From the API

```bash
# Markdown, all events, default cap
curl -H "Cookie: …" \
  "https://app.example.com/api/brokerage/deals/$DEAL_ID/timeline/export"

# JSON, comms only, last 7 days, 500 events
curl -H "Cookie: …" \
  "https://app.example.com/api/brokerage/deals/$DEAL_ID/timeline/export\
?format=json&categories=comms&from=2026-05-11T00:00:00Z&limit=500"
```

Supported query parameters:

- `format` — `markdown` (default) or `json`
- `categories` — comma-separated subset of `document,readiness,comms,banker_action,system`
- `severities` — comma-separated subset of `info,success,warning,error`
- `actorTypes` — comma-separated subset of `borrower,banker,system,provider`
- `from`, `to` — ISO timestamps
- `limit` — integer; capped at 500
- `includeMetadata` — `false` to suppress the header block (notice +
  filter echo are always retained)

The endpoint is auth-gated via `requireBrokerageCommsAdmin()` (super
admin in production; dev fallback in non-Clerk environments). 401 for
unauthenticated requests; 400 if `dealId` is missing.

## Troubleshooting

**Empty export / "No events matched the requested filters."**

- Check whether filters are too narrow. The metadata block echoes the
  exact filters that were applied.
- The 200-event cap inside `getDealTimeline()` can hide older events if
  the deal has heavy comms traffic; raise `limit` (max 500 at export) or
  use a `from`/`to` window.

**A href I expected isn't present.**

- Hrefs are only emitted for the three categories listed under "Safe
  href rules." If you need a link to an external provider artifact,
  that's intentional — external/storage/provider URLs are blocked by
  policy and would defeat the redaction contract.

**The export filename has underscores instead of the deal ID I expected.**

- Deal IDs are slug-sanitized for filename safety. Any non-`[A-Za-z0-9_-]`
  character becomes `_`, and the slug is capped at 36 chars. The full
  deal ID is still present in the JSON `metadata.dealId` field.

**A new event source needs to appear in the timeline.**

- Add a normalizer in `dealTimeline.ts` (`normalize{Source}Event()`),
  add the fetch to the parallel `Promise.all()` in `getDealTimeline()`,
  add the source key to the switch in `normalizeTimelineEvent()`. Make
  sure the new normalizer scrubs recipients/secrets the same way the
  others do, and add at least one test in `dealTimeline.test.ts`.
- Then add the new category (if any) to `VALID_CATEGORIES`,
  `emptySourceSummary()`, and the export markdown source-summary table.
- Then bump `EXPORT_VERSION` if the JSON shape changed.

**Closeout regression failed.**

```bash
pnpm brokerage:timeline:regression
```

runs all four timeline test files together. Any failure here means a
Phase 13 invariant has regressed — typically a write was added, a raw
body slipped through redaction, or an external URL leaked into an href.
The failing assertion will name the specific invariant.
