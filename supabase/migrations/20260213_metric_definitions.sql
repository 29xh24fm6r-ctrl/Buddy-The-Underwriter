-- Model Engine V2: metric_definitions table
-- Stores versioned metric formulas evaluated by metricGraph.ts
-- Phase B: Seed with 7 V1 definitions matching metricRegistryLoader.ts V1_SEED

CREATE TABLE IF NOT EXISTS metric_definitions (
  id                    TEXT PRIMARY KEY,
  version               TEXT NOT NULL DEFAULT 'v1',
  key                   TEXT NOT NULL,
  depends_on            TEXT[] NOT NULL DEFAULT '{}',
  formula               JSONB NOT NULL,
  description           TEXT,
  regulatory_reference  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(version, key)
);

-- RLS: service role only (read by model engine server-side)
ALTER TABLE metric_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON metric_definitions
  FOR ALL USING (auth.role() = 'service_role');

-- Seed V1 metric definitions
INSERT INTO metric_definitions (id, version, key, depends_on, formula, description, regulatory_reference)
VALUES
  (
    'seed-dscr', 'v1', 'DSCR',
    ARRAY['CFADS', 'DEBT_SERVICE'],
    '{"type": "divide", "left": "CFADS", "right": "DEBT_SERVICE"}'::jsonb,
    'Debt Service Coverage Ratio',
    'OCC 2020-32'
  ),
  (
    'seed-leverage', 'v1', 'LEVERAGE',
    ARRAY['TOTAL_DEBT', 'EBITDA'],
    '{"type": "divide", "left": "TOTAL_DEBT", "right": "EBITDA"}'::jsonb,
    'Leverage Ratio (Total Debt / EBITDA)',
    NULL
  ),
  (
    'seed-current-ratio', 'v1', 'CURRENT_RATIO',
    ARRAY['CURRENT_ASSETS', 'CURRENT_LIABILITIES'],
    '{"type": "divide", "left": "CURRENT_ASSETS", "right": "CURRENT_LIABILITIES"}'::jsonb,
    'Current Ratio',
    NULL
  ),
  (
    'seed-debt-to-equity', 'v1', 'DEBT_TO_EQUITY',
    ARRAY['TOTAL_DEBT', 'EQUITY'],
    '{"type": "divide", "left": "TOTAL_DEBT", "right": "EQUITY"}'::jsonb,
    'Debt-to-Equity Ratio',
    NULL
  ),
  (
    'seed-gross-margin', 'v1', 'GROSS_MARGIN',
    ARRAY['GROSS_PROFIT', 'REVENUE'],
    '{"type": "divide", "left": "GROSS_PROFIT", "right": "REVENUE"}'::jsonb,
    'Gross Margin (%)',
    NULL
  ),
  (
    'seed-net-margin', 'v1', 'NET_MARGIN',
    ARRAY['NET_INCOME', 'REVENUE'],
    '{"type": "divide", "left": "NET_INCOME", "right": "REVENUE"}'::jsonb,
    'Net Income Margin (%)',
    NULL
  ),
  (
    'seed-roa', 'v1', 'ROA',
    ARRAY['NET_INCOME', 'TOTAL_ASSETS'],
    '{"type": "divide", "left": "NET_INCOME", "right": "TOTAL_ASSETS"}'::jsonb,
    'Return on Assets',
    NULL
  )
ON CONFLICT (version, key) DO NOTHING;
