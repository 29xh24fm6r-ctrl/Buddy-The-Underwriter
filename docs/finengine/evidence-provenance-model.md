# Evidence & Provenance Model

> SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 27

## Source quality ranking

`provenance.ts::inferSourceQualityRank` (existing) ranks a source 1 (best,
IRS-verified / audited) → 7 (weak OCR). The statement-quality engine (PR 3)
layers on top: it maps the rank to a `reliabilityScore` and multiplies by
assurance, basis, staleness, and partial-year modifiers to a composite
`qualityScore ∈ [0,1]`.

**Rule:** quality conditions *confidence* (`qualityAdjustedConfidence`), never
the metric *value*. A number is never silently changed.

## Evidence bundles (PR 14)

Every analytical conclusion can carry an `EvidenceBundle`:

- `supporting`, `contradicting`, `missing` items, each with a `SourceAnchor`
  (`sourceRef` / `docId` / `page`).
- `confidence ∈ [0,1]` = support-vs-contradiction balance × missing-evidence
  completeness haircut. Unsupported (no supporting and no contradicting) → 0.
- `WithEvidence<T>` carries the bundle through downstream transforms.

## Certified provenance (PR 24)

Certified finengine facts carry:

| field | value |
|---|---|
| `source_type` | `FINENGINE_CERTIFIED` |
| `source_ref` | `finengine:certified:<product>` |
| `extractor` | `finengine.certified.v1` |
| `supersedes` | prior finengine cert only (never legacy) |

## Reconciliation classification (PR 18)

Every metric divergence between legacy and finengine is classified:
`zero` (match), `intended`, `quality_adjusted`, `unexpected`, or `missing`.
The intentional-divergence registry records the *kind* (`intended` /
`legacy_bug` / `finengine_bug` / `data_quality` / `quality_adjusted`) and the
reason. `unexpected` blocks cutover.
