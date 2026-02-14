# Phase 12 — Lock Metric Registry Versioning (Audit Mode)

Owner: Buddy Core
Status: PLANNED
Depends on: Phase 10 complete (9fa0762), Phase 11 in-progress (guardrails + admin replay)

## Objective
Make underwriting computations *auditable and reproducible* by:
1) Versioning the metric registry
2) Binding every V2 snapshot (and key outputs) to an immutable registry version + hash
3) Enforcing immutability rules (no edits to published versions)
4) Providing deterministic replay (admin-only) that uses the registry version referenced by the snapshot

Outcome:
- An examiner can replay a past underwriting result and get identical computed outputs, with a provable registry + hash lineage.

## Non-Goals (Phase 12)
- Deleting V1 code (that's Phase 11/13-type cleanup)
- Re-architecting every computation module
- Building a full UI for registry management (admin minimal is fine)

---

# 0) Definitions

### Metric Registry
A structured list of metric definitions used by V2 computations + spreads mapping.
Each definition includes:
- metric_key (canonical identifier)
- label, description
- unit / formatting rules
- compute inputs/depends_on
- rounding/precision
- validation rules
- spread mapping (if applicable)

### Registry Version
An immutable published snapshot of the registry definitions.

### Registry Hash
A stable content hash computed from the canonical JSON serialization of the version contents.

---

# 1) Data Model (DB)

## 1.1 Tables
Add 2 tables (or equivalent in your schema):

### metric_registry_versions
- id (uuid)
- version_name (text)  # e.g. "2026-02-13.v1" or semantic "v1.3.0"
- version_number (int) # monotonically increasing (optional)
- content_hash (text)  # sha256 of canonical JSON
- status (text)        # "draft" | "published" | "deprecated"
- published_at (timestamptz, nullable)
- created_at, updated_at
- created_by (uuid nullable)

### metric_registry_entries
- id (uuid)
- registry_version_id (uuid fk metric_registry_versions.id)
- metric_key (text)
- definition_json (jsonb) # canonical metric definition
- definition_hash (text)  # sha256 per-entry (optional)
- created_at

Constraints:
- unique(registry_version_id, metric_key)
- metric_registry_versions.content_hash unique (optional but recommended)
- metric_registry_versions.status in ('draft','published','deprecated')

## 1.2 Snapshot binding
Wherever V2 snapshots are stored (Phase 9/10 snapshot persistence):
Add fields if not present:
- registry_version_id (uuid)
- registry_content_hash (text)
- registry_version_name (text) # denormalized for easy viewing
- engine_version (text)        # commit SHA or app version
- compute_trace_id (text)

Hard rule:
- Every persisted V2 snapshot must include registry_version_id + registry_content_hash.

---

# 2) Canonical Hashing (Determinism)

## 2.1 Canonical JSON serialization
Implement `canonicalizeRegistryJson()`:
- stable key ordering
- remove non-semantic fields (timestamps, ids, comments)
- normalize floats/decimals (stringify with fixed precision where needed)
- sort lists deterministically (e.g. by metric_key)

Then compute:
- registry_content_hash = sha256(canonical_json_string)

Location:
- src/lib/metrics/registry/hash.ts

---

# 3) Registry Lifecycle (Draft -> Published -> Immutable)

## 3.1 Draft creation
Admin-only:
- POST /api/admin/metric-registry/versions
  - creates a "draft" version row

## 3.2 Draft population
Admin-only:
- POST /api/admin/metric-registry/versions/:id/entries
  - adds/updates entries while status=draft

## 3.3 Publish
Admin-only:
- POST /api/admin/metric-registry/versions/:id/publish
  - computes content_hash
  - sets status=published
  - sets published_at
  - after publish: entries become immutable

Immutability enforcement:
- If status != draft:
  - reject any update/delete to entries (409 "REGISTRY_IMMUTABLE")

---

# 4) Runtime Selection (Which Registry Does V2 Use?)

## 4.1 Default behavior
When V2 runs (underwrite/standard spread):
- use "active published version" unless overridden by:
  - request parameter (admin-only replay)
  - snapshot binding (replay must use snapshot's registry_version_id)

Define "active published version":
- latest published by published_at (or highest version_number)

Location:
- src/lib/metrics/registry/selectActiveVersion.ts

## 4.2 Record binding on compute
On every V2 compute that persists a snapshot:
- fetch active published version
- embed:
  - registry_version_id
  - registry_version_name
  - registry_content_hash
into the snapshot

If no published version exists:
- fail with explicit error_code: "NO_PUBLISHED_REGISTRY_VERSION"
- (optional) allow fallback to embedded "built-in registry" only in dev

---

# 5) Replay Rules (Audit Determinism)

## 5.1 Replay contract
Admin-only replay endpoint (pairs nicely with Phase 11 PR2):
- GET /api/admin/deals/[dealId]/underwrite/replay?snapshot_id=...&engine=v2

Replay must:
- load snapshot
- load metric_registry_version referenced by snapshot.registry_version_id
- verify registry_content_hash matches snapshot.registry_content_hash
  - if mismatch => emit event + return 409 "REGISTRY_HASH_MISMATCH"
- recompute outputs using the loaded registry version
- compare computed hash of outputs (optional) to stored snapshot outputs hash
- return replay bundle:
  - outputs
  - snapshot metadata
  - registry metadata
  - determinism check status

---

# 6) Output Hashing (Optional but Recommended)

Persist an `outputs_hash` on snapshot:
- sha256(canonicalizeOutputs(outputs))

On replay:
- recompute outputs_hash and compare
- store an event if mismatch

This gives you "math proof" that replay matches.

---

# 7) Events (Aegis / Ledger)

Add event codes:
- METRIC_REGISTRY_DRAFT_CREATED
- METRIC_REGISTRY_PUBLISHED
- METRIC_REGISTRY_IMMUTABLE_VIOLATION
- METRIC_REGISTRY_HASH_MISMATCH
- METRIC_REGISTRY_REPLAY_MATCH
- METRIC_REGISTRY_REPLAY_MISMATCH

Each event includes:
- registry_version_id
- content_hash
- deal_id (if applicable)
- snapshot_id (if applicable)
- trace_id

---

# 8) Health Endpoint Enhancements

Add fields:
- active_registry_version_name
- active_registry_content_hash
- published_versions_count
- last_published_at
- replay_mismatch_count_last_24h

---

# 9) Tests

Unit tests:
- canonicalization stability
- content hash deterministic across key ordering
- publish locks immutability
- runtime selection chooses latest published

Integration tests:
- compute persists snapshot with registry binding
- replay verifies hash match
- replay mismatch path returns 409 + event

---

# 10) Rollout Plan

1) Ship registry tables + admin endpoints (behind admin auth)
2) Publish initial registry version (v1)
3) Update V2 compute to require published registry + bind snapshots
4) Enable output hashing (optional)
5) Turn on health reporting of active registry
6) Run replay on 3 real deals and confirm:
   - hash match
   - outputs_hash match

Exit = Phase 12 DONE
