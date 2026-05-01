# Franchise Intelligence Database — Slice 2B Spec
# Multi-Source FDD Expansion

**Phase:** Franchise Intelligence — Slice 2B (completing Phase 1 data gathering)
**Depends on:** Slice 2 complete (1,331 WI DFI FDDs, scraper infrastructure proven)
**Status (2026-05-01):** MN + NASAA EFD shipped and running on Cloud Scheduler. IN and CA skipped after probe — see "Skipped Sources" below.

---

## Strategic Context

Slice 2 delivered 1,331 FDD filings from Wisconsin DFI. Coverage of SBA-certified brands was 39.6% (585 of 1,476) at the start of Slice 2B. **891 certified brands had no FDD.** Slice 2B targets that gap by adding three additional state-side sources beyond WI.

## Build Order — actual

1. **Minnesota CARDS** — SHIPPED. `scrapeMnFdd.ts` + `scrape-mn-fdd` endpoint. Direct PDF downloads from MN's CARDS portal. 429 burst rate-limit handled with exponential backoff (30s/60s/120s, 3 retries). Runs every 20 min via `franchise-mn-fdd-scrape` Cloud Scheduler.
2. **Indiana SOS** — SKIPPED (reCAPTCHA-blocked). See "Skipped Sources".
3. **NASAA EFD** — SHIPPED. `scrapeNasaaEfd.ts` + `scrape-nasaa-fdd` endpoint. ASP.NET WebForms postback (no captcha) with paired GET-then-POST cookie session. Pilot of 10 well-known brands matched 10/10 with zero overlap against existing WI/MN data, hitting net-new states ND/SD/VA (≥90% of major franchisors) plus sparse NY/IL/RI. Maryland confirmed empty in practice (administrative exemption filings without public FDD bodies). Runs every 20 min via `franchise-nasaa-fdd-scrape` Cloud Scheduler at `batchSize=20 delayMs=3000`.
4. **California DFPI** — SKIPPED (no public FDD data). See "Skipped Sources".

## Architecture

Same `services/franchise-sync-worker` service, new endpoints per source. Each source gets a `_searched_at` column on `franchise_brands` to prevent re-search loops:
- `wi_dfi_searched_at` (Slice 2)
- `mn_cards_searched_at`
- `nasaa_efd_searched_at`

`fdd_filings.source` values in use: `state_wi`, `state_mn`, `nasaa_efd`. `filing_state` is per-row; for NASAA EFD, a single brand can produce filings in multiple states off one search (orchestrator dedupes by `(brand_id, filing_state, filing_year)` against the unique key).

## Skipped Sources

### Indiana SOS — reCAPTCHA-blocked
`https://securities.sos.in.gov/public-portfolio-search/` is plain ASP.NET WebForms (Franchise dropdown GUID `9622c008-7399-e711-8111-1458d04e2938`) but the search POST is gated by reCAPTCHA v2 (sitekey `6LfEycMUAAAAAMOzrvNfCcO4Rp2Ibs6JicrwMj9g`). Server enforces it — POST without a valid `g-recaptcha-response` token returns the form page with `lblError="Please complete the ReCaptcha verification."` No alternate API, no bulk download. Deemed not worth the operational risk for a regulated platform; would require either a paid captcha-solving service (~$10–15/full sweep, runtime dependency) or fragile headless-browser stealth automation.

### California DFPI — no public franchise filings
Three layers of investigation, all dead ends:
1. **`dfpi.ca.gov/search` SearchStax API** is real and accessible (token + endpoint leaked in inline JS — see "Future Opportunities" below) but indexes only the WordPress CMS site (532k docs of news, FAQs, enforcement actions). Not franchise filings.
2. **FRANSES** (`franses.dfpi.ca.gov/franses`) is the actual franchise filing portal — ServiceNow Service Portal exposing a public widget API at `/api/now/sp/page?id=<page-id>`. The homepage `franses_index` returns valid JSON, but every widget on it is filer-side ("Submit a Filing", "Account Set up", "Unsubmitted Notices"). No public-search widget exists.
3. **No bulk lists** — faceted SearchStax queries for `q=franchise registry` filtered to `uri:*.xlsx OR *.pdf` returned 0 results. The `/regulated-entities-list/` page covers Banks, Securities, Escrow, Lenders — franchises are not a category.

CA structurally treats FDDs as filings rather than disclosures: submitted to DFPI for regulatory review, not republished as a public document repository. Unlike WI/MN/SD, California does not publish FDD PDFs publicly. There is nothing to scrape.

## Coverage Summary (post-Slice 2B)

| Source | States | Status |
|---|---|---|
| WI DFI | WI | Complete (Slice 2) |
| MN CARDS | MN | Running |
| NASAA EFD | ND, SD, VA + sparse NY/IL/RI | Running |

9 states total covered. Slice 2B closed.

## Future Opportunities

### CA DFPI Enforcement Intelligence (NOT part of Slice 2B)

The CA DFPI SearchStax index is a clean, undocumented but functional public API for *enforcement actions* against franchisors and securities issuers — distinct from FDD content. Useful for an underwriter-facing "red flag" check.

**Discovered endpoint and credentials** (frontend-public, leaked in inline JS at `dfpi.ca.gov/search-results/` — these are read-only Solr-style query tokens by design, not secrets):

```
url:               https://searchcloud-1-us-west-2.searchstax.com/29847/dfpiprod-1839/emselect
suggester:         https://searchcloud-1-us-west-2.searchstax.com/29847/dfpiprod-1839_suggester/emsuggest
auth header:       Authorization: Token cd1f7b503538c28008a908b324dcc2e8c60a4a3e
related-search:    https://app.searchstax.com/api/v1/1839/related-search/
```

Standard Solr query parameters (`q`, `fq`, `wt=json`, `start`, `rows`, `sort`, `facet.field`). Useful filters seen in the index schema:
- `ss_content_type_s:"Actions and Orders"` — enforcement actions
- `ss_content_type_s:"Consumer Alerts"` — consumer warnings
- `ss_published_date_display_s` — publication date
- URI patterns: `/enforcement_action/`, `/alert/`, `/news/monthly-bulletins/`

Index size: 532,683 documents; ~30,555 contain the term "franchise" (mostly enforcement actions and FAQ pages).

**Hypothesis for use:** during underwriting of a franchise loan, query the DFPI index for the franchisor's legal name; surface any enforcement actions, consumer alerts, or recent monthly-bulletin mentions as a risk-tier input. Would yield CA-specific signal that's not in the FDD body. Separate concern from FDD ingestion — different table, different feature, different UX.

**Not on Slice 2B roadmap.** Logged here so the discovery isn't lost.
