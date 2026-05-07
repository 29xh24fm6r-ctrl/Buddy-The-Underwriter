-- SPEC-13.5 PR-C C-2 — observation view for the 14-day legacy-write
-- observation window.
--
-- Rolls up daily writes to deal_memo_overrides over the trailing 21 days.
-- After 14 consecutive days of zero writes, PR-D (DROP TABLE
-- deal_memo_overrides) becomes unblocked. See:
--   specs/follow-ups/SPEC-13.5-table-deletion.md
--
-- The CI guard (scripts/check-no-legacy-overrides-writes.sh) prevents
-- NEW writers from being added; this view detects whether the three
-- allowlisted writers (builderCanonicalWrite, memo-overrides cockpit
-- endpoint, borrower/update endpoint) actually fire in production.
-- Their migrations are tracked by SPEC-13.7 + SPEC-13.8.
--
-- CREATE OR REPLACE: idempotent, safe to apply at any time.

CREATE OR REPLACE VIEW spec_13_5_legacy_writes_observation AS
SELECT
  date_trunc('day', updated_at) AS day,
  COUNT(*) AS legacy_writes,
  COUNT(DISTINCT deal_id) AS distinct_deals
FROM deal_memo_overrides
WHERE updated_at > NOW() - INTERVAL '21 days'
GROUP BY 1
ORDER BY 1 DESC;
