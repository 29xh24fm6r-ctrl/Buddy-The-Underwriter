# Franchise Intelligence Database — Slice 2B Spec
# Multi-Source FDD Expansion: Minnesota + Indiana + NASAA + California

**Phase:** Franchise Intelligence — Slice 2B (completing Phase 1 data gathering)
**Depends on:** Slice 2 complete (1,331 WI DFI FDDs, scraper infrastructure proven)
**Produces:** 500-1,200 additional FDD filings from 4 new sources, closing coverage gap on certified brands

---

## Strategic Context

Slice 2 delivered 1,331 FDD filings from Wisconsin DFI. Coverage of SBA-certified brands is 39.6% (585 of 1,476). **891 certified brands have no FDD.** Closing this gap completes Phase 1 data gathering.

## Build Order

1. **Minnesota CARDS** — direct document downloads, highest confidence
2. **Indiana SOS** — clean form, 2019+ data only
3. **NASAA EFD** — multi-state (IL, MD, ND, SD), JS-heavy search
4. **California DFPI** — SearchStax search, biggest yield but hardest

## Architecture

Same `franchise-sync-worker` service, new endpoints per source. Each source gets a `_searched_at` column on `franchise_brands` to prevent re-search loops.

See full spec details in the committed spec file.
