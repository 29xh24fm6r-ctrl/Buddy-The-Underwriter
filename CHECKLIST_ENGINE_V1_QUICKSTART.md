# Checklist Engine v1 - Quickstart

## What Just Shipped 🚀

**Trigger-driven, intelligent checklist reconciliation** - documents auto-match to checklist items based on filenames, with zero-latency updates.

## Key Features

1. **Auto-Match on Upload**
   - Banker uploads "PTR 2023.pdf" → automatically matched to `ptr_1yr` checklist item
   - Borrower uploads via portal → same auto-matching logic
   - 12 regex patterns with confidence scoring (0.6+ threshold)

2. **Zero-Latency Reconciliation**
   - PostgreSQL triggers fire when `checklist_key` is set on documents
   - Checklist items update to "Received" **instantly** (no jobs, no polling)
   - `received_at` auto-set, `status` → "received"

3. **Smart UI**
   - New "Reconcile" button re-processes all documents for a deal
   - Doc count overlay shows "(2 docs)" even if received_at not yet set
   - Handles race conditions gracefully

4. **Centralized Engine**
   - All logic in `/src/lib/checklist/` module
   - Idempotent reconciliation (safe to spam)
   - Ledger events log every auto-match

## Quick Test

```bash
# 1. Upload a PTR with recognizable filename
curl -F "file=@PTR_2023.pdf" http://localhost:3000/api/deals/123/files/upload

# 2. Check checklist item
SELECT received_at, status FROM deal_checklist_items WHERE checklist_key = 'ptr_1yr';
# Expected: received_at IS NOT NULL, status = 'received'

# 3. Check ledger
SELECT message FROM deal_pipeline_ledger WHERE event_type = 'checklist_auto_match';
# Expected: "Auto-matched PTR_2023.pdf to ptr_1yr (confidence: 0.9)"
```

## UI Usage

1. Navigate to deal page
2. See checklist items - some will show "Pending", others "Received (2 docs)"
3. Click **Reconcile** button (sync icon) to re-process all documents
4. Items auto-update based on matched filenames

## Architecture

```
Upload → Auto-match filename → Set checklist_key → DB trigger fires → Item marked received
```

**No manual intervention needed** - just upload docs with recognizable filenames.

## Files Changed

**Database**:
- `supabase/migrations/20251231190000_checklist_engine_v1_triggers.sql` (3 functions, 2 triggers)

**Core Engine** (new):
- `src/lib/checklist/types.ts`
- `src/lib/checklist/rules.ts`
- `src/lib/checklist/matchers.ts`
- `src/lib/checklist/engine.ts`

**API Routes** (modified):
- `src/app/api/deals/[dealId]/files/record/route.ts` - auto-match on banker upload
- `src/app/api/portal/upload/commit/route.ts` - auto-match on borrower upload
- `src/app/api/deals/[dealId]/auto-seed/route.ts` - refactored to use engine
- `src/app/api/deals/[dealId]/checklist/doc-summary/route.ts` - new endpoint

**UI** (modified):
- `src/components/deals/EnhancedChecklistCard.tsx` - reconcile button + doc counts

## Patterns Recognized

| Filename Pattern | Checklist Key | Confidence |
|-----------------|---------------|-----------|
| PTR 2023.pdf | ptr_1yr | 0.9 |
| Personal Tax Return 2022.pdf | ptr_2yr | 0.8 |
| BTR 2023.pdf | btr_1yr | 0.9 |
| Business Tax Return 2021.pdf | btr_3yr | 0.8 |
| Schedule of Real Estate Owned.pdf | sor | 0.9 |
| Personal Financial Statement.pdf | pfs | 0.9 |
| Bank Statements 2023.pdf | bank_statements | 0.7 |
| Voided Check.pdf | voided_check | 0.9 |
| Purchase Agreement.pdf | purchase_agreement | 0.8 |
| Business License.pdf | business_license | 0.8 |
| Insurance Certificate.pdf | insurance_cert | 0.8 |
| Corporate Resolution.pdf | corp_resolution | 0.8 |

**Minimum confidence**: 0.6 (configurable)

## Next Steps

1. **Test in staging** - upload various doc types, verify auto-match
2. **Monitor ledger** - check `deal_pipeline_ledger` for match events
3. **Click reconcile** - test manual reconciliation on old deals
4. **Expand rulesets** - add commercial real estate, equipment loan patterns (v2)

## Rollback (If Needed)

```sql
DROP TRIGGER IF EXISTS trg_deal_documents_checklist_reconcile ON deal_documents;
DROP FUNCTION IF EXISTS _checklist_mark_received;
DROP FUNCTION IF EXISTS _checklist_maybe_unreceive;
DROP FUNCTION IF EXISTS _checklist_count_docs;
```

## Full Docs

See [CHECKLIST_ENGINE_V1_COMPLETE.md](./CHECKLIST_ENGINE_V1_COMPLETE.md) for comprehensive documentation.

---

**Status**: ✅ Shipped to `feat/checklist-engine-v1` branch  
**PR**: https://github.com/29xh24fm6r-ctrl/Buddy-The-Underwriter/pull/new/feat/checklist-engine-v1  
**Migration**: Ready to apply to production
