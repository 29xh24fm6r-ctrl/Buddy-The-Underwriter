-- ---------------------------------------------------------------------------
-- Classification Backtesting Views — Calibration Curve
--
-- Denominator: classification.decided events (with confidence_band)
-- Numerator: classification.manual_override events
-- Curve: override_rate per band × tier
--
-- All derive from deal_events only.
-- ---------------------------------------------------------------------------

-- Denominator: total classifications by band/tier
CREATE OR REPLACE VIEW classification_decided_counts_v1 AS
SELECT
  payload->'meta'->>'confidence_band' AS band,
  payload->'evidence'->>'tier' AS tier,
  COUNT(*) AS total
FROM deal_events
WHERE kind = 'classification.decided'
  AND payload->'meta'->>'confidence_band' IS NOT NULL
GROUP BY 1, 2;

-- Numerator: overrides by band/tier
CREATE OR REPLACE VIEW classification_override_counts_v1 AS
SELECT
  payload->'meta'->>'confidence_band' AS band,
  COALESCE(payload->'meta'->>'classifier_source', 'unknown') AS tier,
  COUNT(*) AS overrides
FROM deal_events
WHERE kind = 'classification.manual_override'
GROUP BY 1, 2;

-- Calibration curve: override rate per band/tier
CREATE OR REPLACE VIEW classification_calibration_curve_v1 AS
SELECT
  f.band,
  f.tier,
  f.total,
  COALESCE(o.overrides, 0) AS overrides,
  (COALESCE(o.overrides, 0)::numeric / NULLIF(f.total, 0)) AS override_rate
FROM classification_decided_counts_v1 f
LEFT JOIN classification_override_counts_v1 o
  ON f.band = o.band AND f.tier = o.tier;
