# Franchise Intelligence Database — Slice 3 Spec
# FDD Extraction: Gemini Vision → Investment Economics + Item 19 Performance Data

See full spec in chat history or FRANCHISE_DB_SLICE3_SPEC.md.

## Summary

New Cloud Run service `franchise-fdd-extractor` reads FDD PDFs from GCS using Gemini Vision (REST API, page-targeted extraction) and populates:
- `fdd_item19_facts` — normalized financial performance metrics from Item 19
- `franchise_brands` — investment economics (fees, costs, royalties) from Items 5/6/7/20
- `fdd_filings` — raw JSON in item_*_json columns + extraction_status → complete

## Key Design Decisions
- Page-targeted extraction (TOC → specific item pages) reduces cost from ~$400 to ~$2.50 for full corpus
- Gemini REST API (not Vertex SDK) — matches existing `callGeminiJSON` pattern
- Separate Cloud Run service — isolates from scraper, higher CPU/memory for PDF processing
- `pdf-lib` for page slicing — pure JS, no native binaries
- Cloud Scheduler every 20 min, batchSize=5 (25 Gemini calls/batch), ~4 days for full corpus

## Estimated Cost
~$2.50 for 1,449 FDD filings (page-targeted at ~$0.002/filing)
